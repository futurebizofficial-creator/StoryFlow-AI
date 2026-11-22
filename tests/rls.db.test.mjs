// RLS / migration integration test against PGlite with a minimal Supabase auth stub.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const dir = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
// Foundation + video migrations. The invite-only migration (20261123…) changes owner/admin
// rules and is covered, on top of seeded data, by tests/invite-only.db.test.mjs.
const migration = readdirSync(dir).filter((f) => f.endsWith(".sql") && f < "20261123").sort().map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
const db = new PGlite();

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean not null, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1, '/') $$;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on all functions in schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
`);
await db.exec(migration);
console.log("✓ migration applied");

const U = {
  a: ["00000000-0000-0000-0000-00000000000a", "a@x.com"],
  b: ["00000000-0000-0000-0000-00000000000b", "b@x.com"],
  c: ["00000000-0000-0000-0000-00000000000c", "c@x.com"],
};
for (const [id, email] of Object.values(U)) {
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, email.toUpperCase(), { full_name: "User " + email[0] }]);
}
const profs = await db.query(`select email, full_name from public.profiles order by email`);
assert.equal(profs.rows.length, 3);
assert.equal(profs.rows[0].email, "a@x.com");
console.log("✓ profiles created by trigger (email lowercased)");

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
const ok = (label) => console.log(`✓ ${label}`);

// Workspaces
const wsA = (await as("a", `select public.create_workspace('Acme Studios') as id`)).rows[0].id;
assert.equal((await as("a", `select role from workspace_members where workspace_id = $1`, [wsA])).rows[0].role, "owner");
ok("create_workspace makes caller owner");
assert.match((await as("a", `select slug from workspaces where id=$1`, [wsA])).rows[0].slug, /^acme-studios-[a-z0-9]{6}$/);
ok("slug generated");

assert.equal((await as("b", `select * from workspaces`)).rows.length, 0);
assert.equal((await as("b", `select * from workspace_members`)).rows.length, 0);
ok("non-member sees no workspaces or members");
await fails("b", `insert into projects (workspace_id, name, created_by) values ($1, 'x', $2)`, [wsA, U.b[0]], /row-level security/, "non-member cannot insert project");
await fails("b", `insert into workspaces (name, slug) values ('x', 'x')`, [], /permission denied/, "direct workspace insert blocked");
await fails("b", `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [wsA, U.b[0]], /permission denied/, "direct membership insert blocked");
assert.equal((await as("b", `select * from profiles`)).rows.length, 1);
ok("profiles visible only to self when no shared workspace");

const videoScript = (await as("a", `insert into scripts (workspace_id,title,content,created_by) values ($1,'Queue test','A sufficiently long script body for testing persistent rendering jobs.',$2) returning id`, [wsA, U.a[0]])).rows[0].id;
const videoJob = (await as("a", `insert into video_jobs (workspace_id,script_id,created_by,request) values ($1,$2,$3,'{"title":"Queue test","script":"A sufficiently long script body for testing persistent rendering jobs."}') returning id`, [wsA, videoScript, U.a[0]])).rows[0].id;
assert.equal((await as("b", `select * from video_jobs where id=$1`, [videoJob])).rows.length, 0);
const styledJob = (await as("a", `insert into video_jobs (workspace_id,script_id,created_by,request) values ($1,$2,$3,$4::jsonb) returning request`, [
  wsA, videoScript, U.a[0],
  JSON.stringify({ title: "Styled", script: "A sufficiently long script body for a styled render job.", orientation: "portrait", voice: "en-US-AriaNeural", showText: true, textConfig: { position: "bottom", fontSize: 64, glow: true }, backgroundMusic: "calm.mp3" }),
])).rows[0].request;
assert.equal(styledJob.textConfig.position, "bottom");
assert.equal(styledJob.backgroundMusic, "calm.mp3");
ok("members can queue jobs with subtitle, music and voice settings (no schema change)");
ok("video jobs hidden from non-members");
await fails("a", `update video_jobs set status='completed' where id=$1`, [videoJob], /permission denied/, "members cannot forge worker job updates");
await fails("a", `insert into video_jobs (workspace_id,script_id,created_by,request,status,output_url) values ($1,$2,$3,'{"title":"Forged","script":"A sufficiently long script body for a forged job."}','completed',$4)`, [wsA, videoScript, U.a[0], `${wsA}/x/video.mp4`], /permission denied/, "members cannot insert worker-owned job fields");
await fails("a", `insert into video_jobs (workspace_id,script_id,created_by,request,attempts) values ($1,$2,$3,'{"title":"Forged","script":"A sufficiently long script body for a forged job."}',3)`, [wsA, videoScript, U.a[0]], /permission denied/, "members cannot preset job attempts");
assert.equal((await as("a", `select status,progress,attempts,output_url from video_jobs where id=$1`, [videoJob])).rows[0].status, "queued");
ok("member-created job starts from worker defaults");
await db.exec("set role service_role");
const claimed = await db.query(`select id,status,attempts from public.claim_video_job()`);
await db.exec("reset role");
assert.equal(claimed.rows[0].id, videoJob);
assert.equal(claimed.rows[0].status, "running");
assert.equal(claimed.rows[0].attempts, 1);
ok("worker atomically claims a persistent video job");

await as("a", `insert into workspace_provider_credentials (workspace_id,user_id,provider,ciphertext,nonce,auth_tag) values ($1,$2,'anthropic','cipher','nonce','tag')`, [wsA, U.a[0]]);
assert.equal((await as("b", `select * from workspace_provider_credentials where workspace_id=$1`, [wsA])).rows.length, 0);
ok("BYOK credentials are isolated to their user");
await as("a", `insert into google_drive_connections (user_id,ciphertext,nonce,auth_tag) values ($1,'cipher','nonce','tag')`, [U.a[0]]);
assert.equal((await as("b", `select * from google_drive_connections`)).rows.length, 0);
ok("Google Drive connections are isolated to their user");

const wsB = (await as("b", `select public.create_workspace('Beta') as id`)).rows[0].id;

// Projects
const pA = (await as("a", `insert into projects (workspace_id, name, created_by) values ($1, 'Launch', $2) returning id`, [wsA, U.a[0]])).rows[0].id;
await fails("a", `update projects set workspace_id = $1 where id = $2`, [wsB, pA], null, "project workspace_id cannot change");
await fails("b", `insert into scripts (workspace_id, project_id, title, created_by) values ($1, $2, 't', $3)`, [wsB, pA, U.b[0]], null, "script cannot reference project from another workspace");

// Invitations
await as("a", `insert into workspace_invitations (workspace_id, email, role, invited_by) values ($1, 'b@x.com', 'admin', $2)`, [wsA, U.a[0]]);
ok("owner can invite admin");
await fails("a", `insert into workspace_invitations (workspace_id, email, role, invited_by) values ($1, 'b@x.com', 'member', $2)`, [wsA, U.a[0]], /duplicate|unique/, "duplicate pending invitation rejected");
await fails("a", `insert into workspace_invitations (workspace_id, email, role, invited_by) values ($1, 'z@x.com', 'owner', $2)`, [wsA, U.a[0]], null, "owner-role invitation rejected");
await fails("c", `insert into workspace_invitations (workspace_id, email, role, invited_by) values ($1, 'c@x.com', 'member', $2)`, [wsA, U.c[0]], /row-level security/, "non-member cannot self-invite");

const pending = await as("b", `select * from public.my_pending_invitations()`);
assert.equal(pending.rows.length, 1);
assert.equal(pending.rows[0].workspace_name, "Acme Studios");
ok("invitee sees pending invitation");
assert.equal((await as("c", `select * from workspace_invitations`)).rows.length, 0);
ok("other users cannot see the invitation");

await fails("c", `select public.accept_invitation($1)`, [pending.rows[0].token], /different email/, "wrong user cannot accept invitation");
await as("b", `select public.accept_invitation($1)`, [pending.rows[0].token]);
assert.equal((await as("b", `select role from workspace_members where workspace_id=$1 and user_id=$2`, [wsA, U.b[0]])).rows[0].role, "admin");
ok("invitee accepts and becomes admin");
await fails("b", `select public.accept_invitation($1)`, [pending.rows[0].token], /no longer valid/, "invitation cannot be reused");
assert.equal((await as("b", `select * from projects where workspace_id=$1`, [wsA])).rows.length, 1);
ok("new member can read workspace projects");
assert.equal((await as("a", `select * from profiles`)).rows.length, 2);
ok("teammate profiles visible after joining");

// Admin limits
await fails("b", `insert into workspace_invitations (workspace_id, email, role, invited_by) values ($1, 'c@x.com', 'admin', $2)`, [wsA, U.b[0]], /row-level security/, "admin cannot invite admins");
await as("b", `insert into workspace_invitations (workspace_id, email, role, invited_by) values ($1, 'c@x.com', 'member', $2)`, [wsA, U.b[0]]);
const tokC = (await as("c", `select token from public.my_pending_invitations()`)).rows[0].token;
await as("c", `select public.accept_invitation($1)`, [tokC]);
ok("admin can invite member; member joins");

// Member limits
await fails("c", `select public.update_member_role($1, $2, 'member')`, [wsA, U.b[0]], /permission/, "member cannot change roles");
await fails("c", `select public.remove_member($1, $2)`, [wsA, U.b[0]], /permission/, "member cannot remove others");
await fails("c", `update workspaces set name = 'Hacked' where id = $1 returning id`, [wsA], null, "member cannot rename workspace").catch(async () => {
  const r = await as("c", `update workspaces set name = 'Hacked' where id = $1 returning id`, [wsA]);
  assert.equal(r.rows.length, 0);
  ok("member cannot rename workspace (0 rows)");
});
assert.equal((await as("c", `delete from projects where id=$1 returning id`, [pA])).rows.length, 0);
ok("member cannot delete another user's project");
const pC = (await as("c", `insert into projects (workspace_id, name, created_by) values ($1, 'Mine', $2) returning id`, [wsA, U.c[0]])).rows[0].id;
assert.equal((await as("c", `delete from projects where id=$1 returning id`, [pC])).rows.length, 1);
ok("member can delete own project");
await fails("c", `insert into workspace_integrations (workspace_id, provider) values ($1, 'openai')`, [wsA], /row-level security/, "member cannot change integrations");
await fails("c", `select * from workspace_invitations where workspace_id = $1`, [wsA], null, "noop").catch(() => {});
assert.equal((await as("c", `select * from workspace_invitations where workspace_id = $1`, [wsA])).rows.length, 0);
ok("member cannot list workspace invitations");

// Admin role management
await fails("b", `select public.update_member_role($1, $2, 'member')`, [wsA, U.a[0]], /owner/, "admin cannot demote owner");
await fails("b", `select public.update_member_role($1, $2, 'owner')`, [wsA, U.c[0]], /owner/, "admin cannot grant owner");
await as("b", `select public.update_member_role($1, $2, 'admin')`, [wsA, U.c[0]]);
ok("admin can promote member to admin");
await as("c", `insert into workspace_integrations (workspace_id, provider, enabled, settings) values ($1, 'anthropic', true, '{"default_model":"x"}')`, [wsA]);
ok("admin can save integration settings");
await fails("b", `select public.remove_member($1, $2)`, [wsA, U.c[0]], /only remove members/, "admin cannot remove another admin");
await fails("b", `select public.update_member_role($1, $2, 'member')`, [wsA, U.b[0]], /own role/, "cannot change own role");

// Owner rules
await fails("a", `select public.remove_member($1, $2)`, [wsA, U.a[0]], /at least one owner/, "sole owner cannot leave");
await as("a", `select public.update_member_role($1, $2, 'owner')`, [wsA, U.b[0]]);
await as("a", `select public.remove_member($1, $2)`, [wsA, U.a[0]]);
ok("owner can leave once another owner exists");
assert.equal((await as("a", `select * from workspaces where id=$1`, [wsA])).rows.length, 0);
ok("former member loses access");

// Revoke & column privileges
await as("b", `insert into workspace_invitations (workspace_id, email, role, invited_by) values ($1, 'z@x.com', 'member', $2)`, [wsA, U.b[0]]);
await fails("b", `update workspace_invitations set status = 'accepted' where email = 'z@x.com'`, [], /row-level security/, "admin cannot mark invitation accepted");
await as("b", `update workspace_invitations set status = 'revoked' where email = 'z@x.com'`);
ok("admin can revoke invitation");
await fails("b", `update workspace_invitations set role = 'admin' where email = 'z@x.com'`, [], /permission denied/, "invitation role column not updatable");

// Anonymous
await fails(null, `select * from profiles`, [], /permission denied/, "anon cannot read tables");
await fails(null, `select public.create_workspace('x')`, [], /permission denied/, "anon cannot call RPCs");
for (const table of ["video_jobs", "workspace_provider_credentials", "google_drive_connections"]) {
  await fails(null, `select * from public.${table}`, [], /permission denied/, `anon has no privileges on ${table}`);
}
await fails(null, `insert into video_jobs (workspace_id,script_id,created_by,request) values ($1,$2,$3,'{"title":"Anon","script":"A sufficiently long script body from an anonymous caller."}')`, [wsA, videoScript, U.a[0]], /permission denied/, "anon cannot insert video jobs");
await fails(null, `delete from google_drive_connections`, [], /permission denied/, "anon cannot delete drive connections");
await fails(null, `update workspace_provider_credentials set ciphertext = 'x'`, [], /permission denied/, "anon cannot update provider credentials");

// Storage bucket accepts both image formats the worker can upload.
await db.exec("reset role");
const bucket = (await db.query(`select public, allowed_mime_types from storage.buckets where id = 'storyflow-videos'`)).rows[0];
assert.equal(bucket.public, false);
for (const mime of ["video/mp4", "image/png", "image/jpeg"]) assert.ok(bucket.allowed_mime_types.includes(mime), `bucket allows ${mime}`);
ok("storyflow-videos bucket is private and allows MP4, PNG and JPEG");

// Delete workspace
assert.equal((await as("c", `delete from workspaces where id=$1 returning id`, [wsA])).rows.length, 0);
ok("admin cannot delete workspace");
assert.equal((await as("b", `delete from workspaces where id=$1 returning id`, [wsA])).rows.length, 1);
ok("owner deletes workspace (cascade passes owner guard)");
await db.exec("reset role");
assert.equal((await db.query(`select count(*)::int n from projects where workspace_id=$1`, [wsA])).rows[0].n, 0);
ok("cascade removed workspace data");

console.log("\nAll RLS checks passed.");
