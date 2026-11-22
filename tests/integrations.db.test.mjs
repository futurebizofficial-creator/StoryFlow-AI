// Integrations Hub migration: provider keys, enable/disable and generation settings under RLS.
// Seeds production-like data (owners, admin, member, an existing Claude key) before applying
// the invite-only and integrations migrations, then checks isolation and permissions.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const dir = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const sql = (pred) => files.filter(pred).map((f) => readFileSync(join(dir, f), "utf8")).join("\n");

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean not null, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1, '/') $$;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on all functions in schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
`);
await db.exec(sql((f) => f < "20261123"));

const U = {
  owner: ["00000000-0000-0000-0000-0000000000a1", "owner@x.com"],
  admin: ["00000000-0000-0000-0000-0000000000a2", "admin@x.com"],
  member: ["00000000-0000-0000-0000-0000000000a3", "member@x.com"],
  other: ["00000000-0000-0000-0000-0000000000b1", "other@x.com"],
};
const ok = (label) => console.log(`✓ ${label}`);
async function as(user, query, params = []) {
  await db.exec("reset role");
  const claims = user ? JSON.stringify({ sub: U[user][0], email: U[user][1], role: "authenticated" }) : "";
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
  await db.exec(user ? "set role authenticated" : "set role anon");
  try {
    return await db.query(query, params);
  } finally {
    await db.exec("reset role");
  }
}
async function fails(user, query, params, re, label) {
  try {
    await as(user, query, params);
  } catch (e) {
    if (re) assert.match(e.message, re, label);
    console.log(`✓ ${label} (${e.message.split("\n")[0]})`);
    return;
  }
  throw new Error(`Expected failure: ${label}`);
}

for (const [id, email] of Object.values(U)) await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
const wsA = (await as("owner", `select public.create_workspace('Studio A') as id`)).rows[0].id;
const wsB = (await as("other", `select public.create_workspace('Studio B') as id`)).rows[0].id;
await db.query(`insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'admin'), ($1, $3, 'member')`, [wsA, U.admin[0], U.member[0]]);
const sealed = { ciphertext: "Y2lwaGVy", nonce: "bm9uY2U=", auth_tag: "dGFn" };
await as("owner", `insert into workspace_provider_credentials (workspace_id, user_id, provider, ciphertext, nonce, auth_tag) values ($1, $2, 'anthropic', $3, $4, $5)`, [wsA, U.owner[0], sealed.ciphertext, sealed.nonce, sealed.auth_tag]);

await db.exec(sql((f) => f >= "20261123"));
ok("invite-only + integrations migrations apply over existing data");
assert.equal((await as("owner", `select count(*)::int n from workspace_provider_credentials where provider = 'anthropic'`)).rows[0].n, 1);
ok("existing Claude key preserved");

// --- Provider keys: new providers, own rows only, never across users or workspaces.
const insertKey = `insert into workspace_provider_credentials (workspace_id, user_id, provider, ciphertext, nonce, auth_tag) values ($1, $2, $3, 'c', 'n', 't')`;
for (const provider of ["groq", "pexels", "elevenlabs", "unsplash", "google_tts"]) await as("member", insertKey, [wsA, U.member[0], provider]);
ok("members can save keys for new providers");
await fails("member", insertKey, [wsA, U.member[0], "youtube"], /check constraint/, "OAuth-only providers cannot store API keys");
await fails("member", insertKey, [wsA, U.member[0], "made_up"], /check constraint/, "unknown providers are rejected");
await fails("member", insertKey, [wsA, U.owner[0], "openai"], /row-level security/, "cannot save a key as another user");
await fails("other", insertKey, [wsA, U.other[0], "openai"], /row-level security/, "cannot save keys into another workspace");
assert.equal((await as("owner", `select count(*)::int n from workspace_provider_credentials where user_id <> $1`, [U.owner[0]])).rows[0].n, 0);
assert.equal((await as("admin", `select count(*)::int n from workspace_provider_credentials`)).rows[0].n, 0);
assert.equal((await as("other", `select count(*)::int n from workspace_provider_credentials`)).rows[0].n, 0);
ok("keys are invisible to owners, admins and other workspaces (own rows only)");
await as("member", `delete from workspace_provider_credentials where provider = 'groq'`);
assert.equal((await as("member", `select count(*)::int n from workspace_provider_credentials where provider = 'groq'`)).rows[0].n, 0);
assert.equal((await as("owner", `delete from workspace_provider_credentials where user_id = $1 returning provider`, [U.member[0]])).rows.length, 0);
ok("members can disconnect their own keys; nobody else can delete them");
await fails(null, `select * from workspace_provider_credentials`, [], /permission denied/, "anonymous users cannot read keys");

// --- Enable/disable: owners and admins only.
const toggle = `insert into workspace_integrations (workspace_id, provider, enabled, updated_by) values ($1, $2, false, $3)`;
await as("admin", toggle, [wsA, "groq", U.admin[0]]);
await as("owner", toggle, [wsA, "tiktok", U.owner[0]]);
ok("owners and admins can disable providers");
await fails("member", toggle, [wsA, "pexels", U.member[0]], /row-level security/, "members cannot enable/disable providers");
await fails("other", toggle, [wsA, "pexels", U.other[0]], /row-level security/, "other workspaces cannot change providers");
await fails("owner", toggle, [wsA, "made_up", U.owner[0]], /check constraint/, "unknown provider ids are rejected");

// --- Generation settings: members read, owners/admins write, scoped per workspace.
const upsert = `insert into workspace_generation_settings (workspace_id, free_mode, ai_providers, ai_models, updated_by) values ($1, $2, $3, $4::jsonb, $5)`;
await as("admin", upsert, [wsA, true, ["groq", "gemini"], JSON.stringify({ groq: "m1", gemini: "g1" }), U.admin[0]]);
const row = (await as("member", `select free_mode, ai_providers from workspace_generation_settings where workspace_id = $1`, [wsA])).rows[0];
assert.deepEqual(row, { free_mode: true, ai_providers: ["groq", "gemini"] });
ok("admins save generation settings; members can read them");
assert.equal((await as("member", `update workspace_generation_settings set free_mode = false, updated_by = $2 where workspace_id = $1 returning 1`, [wsA, U.member[0]])).rows.length, 0);
ok("members cannot change Free Mode (0 rows)");
assert.equal((await as("owner", `select free_mode from workspace_generation_settings where workspace_id = $1`, [wsA])).rows[0].free_mode, true);
assert.equal((await as("other", `select count(*)::int n from workspace_generation_settings`)).rows[0].n, 0);
ok("other workspaces cannot read the settings");
await fails("other", upsert, [wsA, false, ["anthropic"], "{}", U.other[0]], /row-level security/, "other workspaces cannot write the settings");
await fails("owner", upsert, [wsB, false, ["anthropic"], "{}", U.owner[0]], /row-level security/, "owner of A cannot write B's settings");
await fails("other", upsert, [wsB, false, ["made_up"], "{}", U.other[0]], /check constraint/, "unknown AI providers are rejected");
await fails("other", upsert, [wsB, false, [], "{}", U.other[0]], /check constraint/, "an empty provider list is rejected");
await fails("other", upsert, [wsB, false, ["pexels"], "{}", U.other[0]], /check constraint/, "non-LLM providers cannot be scene planners");
await fails("admin", `update workspace_generation_settings set workspace_id = $2, updated_by = $3 where workspace_id = $1`, [wsA, wsB, U.admin[0]], /workspace_id cannot be changed|row-level security/, "settings cannot move to another workspace");
await fails("owner", `delete from workspace_generation_settings where workspace_id = $1`, [wsA], /permission denied/, "settings cannot be deleted through the API");
await fails(null, `select * from workspace_generation_settings`, [], /permission denied/, "anonymous users cannot read settings");
await as("other", upsert, [wsB, false, ["anthropic"], "{}", U.other[0]]);
assert.equal((await as("other", `select free_mode from workspace_generation_settings where workspace_id = $1`, [wsB])).rows[0].free_mode, false);
ok("each workspace has its own settings");

console.log("\nAll integrations checks passed.");
