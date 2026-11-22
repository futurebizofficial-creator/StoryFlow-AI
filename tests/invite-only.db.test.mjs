// Invite-only registration: applies the foundation + video migrations, seeds an existing owner
// (as in production), then applies 20261123000000_invite_only_registration.sql and verifies it.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const dir = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const before = files.filter((f) => f < "20261123").map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
const inviteOnly = files.filter((f) => f >= "20261123").map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
assert.ok(inviteOnly.includes("enforce_invite_only_signup"), "invite-only migration present");

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean not null, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1, '/') $$;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on all functions in schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  -- Same as this Supabase project: new public tables give anon/authenticated no data privileges,
  -- so every table the app uses needs an explicit grant (regression for missing grants).
  alter default privileges in schema public grant truncate, references, trigger on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
`);
await db.exec(before);

const U = {
  owner: ["00000000-0000-0000-0000-0000000000a1", "owner@x.com"],
  member: ["00000000-0000-0000-0000-0000000000b2", "member@x.com"],
  admin: ["00000000-0000-0000-0000-0000000000c3", "admin@x.com"],
};
const ok = (label) => console.log(`✓ ${label}`);

async function as(user, sql, params = []) {
  await db.exec("reset role");
  const claims = user ? JSON.stringify({ sub: U[user][0], email: U[user][1], role: "authenticated" }) : "";
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
  await db.exec(user ? "set role authenticated" : "set role anon");
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role");
  }
}
async function fails(user, sql, params, re, label) {
  try {
    await as(user, sql, params);
  } catch (e) {
    if (re) assert.match(e.message, re, label);
    console.log(`✓ ${label} (${e.message.split("\n")[0]})`);
    return;
  }
  throw new Error(`Expected failure: ${label}`);
}
/** Simulates Supabase Auth creating a user (runs with the auth service's privileges). */
async function authSignup(email, metadata) {
  await db.exec("reset role");
  return db.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`, [email, JSON.stringify(metadata ?? {})]);
}
async function signupFails(email, metadata, label) {
  try {
    await authSignup(email, metadata);
  } catch (e) {
    assert.match(e.message, /invitation only/i, label);
    console.log(`✓ ${label} (${e.message.split("\n")[0]})`);
    return;
  }
  throw new Error(`Expected signup failure: ${label}`);
}

// --- Existing production-like state: one owner with a workspace, plus a pre-existing admin & member.
for (const [id, email] of Object.values(U)) {
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}')`, [id, email]);
}
const ws = (await as("owner", `select public.create_workspace('Owner Studio') as id`)).rows[0].id;
await db.query(`insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member'), ($1, $3, 'admin')`, [ws, U.member[0], U.admin[0]]);
const profilesBefore = (await db.query(`select count(*)::int n from public.profiles`)).rows[0].n;

// --- Apply the invite-only migration on top of existing data.
await db.exec(inviteOnly);
ok("invite-only migration applies over existing data");
assert.equal((await db.query(`select count(*)::int n from public.profiles`)).rows[0].n, profilesBefore);
assert.deepEqual((await db.query(`select user_id from public.platform_owners`)).rows.map((r) => r.user_id), [U.owner[0]]);
ok("existing owner recorded as the only platform owner; existing users untouched");
assert.equal((await as("owner", `select role from workspace_members where user_id = $1`, [U.owner[0]])).rows[0].role, "owner");
ok("existing owner keeps owner role");

// --- Invitation creation: owner only, member only.
const invite = (await as("owner", `insert into workspace_invitations (workspace_id, email, role, invited_by) values ($1, 'new@x.com', 'member', $2) returning token`, [ws, U.owner[0]])).rows[0].token;
ok("owner can create a member invitation");
await fails("owner", `insert into workspace_invitations (workspace_id, email, role, invited_by) values ($1, 'boss@x.com', 'admin', $2)`, [ws, U.owner[0]], /row-level security|check constraint/, "owner cannot create admin invitation");
await fails("admin", `insert into workspace_invitations (workspace_id, email, role, invited_by) values ($1, 'x1@x.com', 'member', $2)`, [ws, U.admin[0]], /row-level security/, "admin cannot create invitations");
await fails("member", `insert into workspace_invitations (workspace_id, email, role, invited_by) values ($1, 'x2@x.com', 'member', $2)`, [ws, U.member[0]], /row-level security/, "member cannot create invitations");
await fails(null, `insert into workspace_invitations (workspace_id, email, role) values ($1, 'x3@x.com', 'member')`, [ws], /permission denied/, "anonymous cannot create invitations");
assert.equal((await as("admin", `select * from workspace_invitations`)).rows.length, 0);
ok("admins cannot list workspace invitations");
assert.equal((await as("admin", `update workspace_invitations set status = 'revoked' where token = $1 returning id`, [invite])).rows.length, 0);
assert.equal((await as("owner", `select status from workspace_invitations where token = $1`, [invite])).rows[0].status, "pending");
ok("invitation still pending after admin attempt");

// --- Anonymous pre-check exposes only a boolean.
assert.equal((await as(null, `select public.signup_invitation_is_valid($1) as v`, [invite])).rows[0].v, true);
assert.equal((await as(null, `select public.signup_invitation_is_valid($1, 'NEW@x.com') as v`, [invite])).rows[0].v, true);
assert.equal((await as(null, `select public.signup_invitation_is_valid($1, 'other@x.com') as v`, [invite])).rows[0].v, false);
assert.equal((await as(null, `select public.signup_invitation_is_valid(gen_random_uuid()) as v`)).rows[0].v, false);
ok("anonymous signup pre-check returns only valid/invalid");
await fails(null, `select * from public.get_invitation($1)`, [invite], /permission denied/, "anonymous cannot read invitation details");
await fails(null, `select * from workspace_invitations`, [], /permission denied/, "anonymous cannot read invitations table");
await fails("member", `select * from public.platform_owners`, [], /permission denied/, "platform_owners not readable through the API");

// --- Direct signup attempts.
await signupFails("random@x.com", {}, "direct signup without token is rejected");
await signupFails("random@x.com", { invitation_token: "not-a-uuid" }, "malformed token is rejected");
await signupFails("random@x.com", { invitation_token: "11111111-1111-4111-8111-111111111111" }, "unknown token is rejected");
await signupFails("wrong@x.com", { invitation_token: invite }, "valid token with wrong email is rejected");

const expired = (await as("owner", `insert into workspace_invitations (workspace_id, email, role, invited_by, expires_at) values ($1, 'late@x.com', 'member', $2, now() - interval '1 minute') returning token`, [ws, U.owner[0]])).rows[0].token;
await signupFails("late@x.com", { invitation_token: expired }, "expired invitation is rejected");
assert.equal((await as(null, `select public.signup_invitation_is_valid($1) as v`, [expired])).rows[0].v, false);

const revoked = (await as("owner", `insert into workspace_invitations (workspace_id, email, role, invited_by) values ($1, 'gone@x.com', 'member', $2) returning token`, [ws, U.owner[0]])).rows[0].token;
await as("owner", `update workspace_invitations set status = 'revoked' where token = $1`, [revoked]);
ok("owner can revoke an invitation");
await signupFails("gone@x.com", { invitation_token: revoked }, "revoked invitation is rejected");

// --- Valid invited signup, then accept after login.
const created = (await authSignup("New@X.com", { full_name: "New Person", invitation_token: invite })).rows[0].id;
ok("signup with a valid invitation succeeds (email match is case-insensitive)");
const profile = (await db.query(`select email, full_name from public.profiles where id = $1`, [created])).rows[0];
assert.deepEqual(profile, { email: "new@x.com", full_name: "New Person" });
ok("profile creation trigger still runs");
U.newbie = [created, "new@x.com"];
assert.equal((await as("newbie", `select count(*)::int n from public.my_pending_invitations()`)).rows[0].n, 1);
await as("newbie", `select public.accept_invitation($1)`, [invite]);
assert.equal((await as("newbie", `select role from workspace_members where workspace_id = $1 and user_id = $2`, [ws, created])).rows[0].role, "member");
ok("invited user accepts and joins as member");
await fails("newbie", `select public.accept_invitation($1)`, [invite], /no longer valid/, "invitation cannot be reused");
await signupFails("new2@x.com", { invitation_token: invite }, "accepted invitation cannot be used to sign up again");

// --- No path to owner privileges for anyone else.
await fails("newbie", `select public.create_workspace('My Own Studio')`, [], /platform owner/, "invited member cannot create a workspace");
await fails("admin", `select public.create_workspace('Admin Studio')`, [], /platform owner/, "admin cannot create a workspace");
const second = (await as("owner", `select public.create_workspace('Second Studio') as id`)).rows[0].id;
ok("platform owner can still create workspaces");
await fails("owner", `select public.update_member_role($1, $2, 'owner')`, [ws, U.member[0]], /cannot be granted/, "owner cannot grant owner role");
await fails("admin", `select public.update_member_role($1, $2, 'admin')`, [ws, U.member[0]], /Only owners/, "admin cannot change roles");
await fails("member", `select public.update_member_role($1, $2, 'admin')`, [ws, U.newbie[0]], /Only owners/, "member cannot change roles");
await as("owner", `select public.update_member_role($1, $2, 'admin')`, [ws, U.member[0]]);
await as("owner", `select public.update_member_role($1, $2, 'member')`, [ws, U.member[0]]);
ok("owner can still promote/demote between admin and member");
await fails("member", `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [second, U.member[0]], /permission denied/, "direct membership insert blocked");
await db.exec("reset role");
await assert.rejects(
  db.query(`update public.workspace_members set role = 'owner' where workspace_id = $1 and user_id = $2`, [ws, U.member[0]]),
  /platform owner/,
);
await assert.rejects(
  db.query(`insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [second, U.admin[0]]),
  /platform owner/,
);
ok("even privileged writes cannot give a non-platform-owner the owner role");
await assert.rejects(
  db.query(`insert into public.workspace_invitations (workspace_id, email, role) values ($1, 'adm@x.com', 'admin')`, [ws]),
  /check constraint/,
);
ok("database rejects non-member invitations even for privileged writes");

// --- Existing users and login are unaffected (no insert happens on login); updates still work.
await db.query(`update auth.users set email = 'member2@x.com' where id = $1`, [U.member[0]]);
assert.equal((await db.query(`select email from public.profiles where id = $1`, [U.member[0]])).rows[0].email, "member2@x.com");
ok("existing users can still be updated (email-change trigger intact)");

console.log("\nAll invite-only checks passed.");
