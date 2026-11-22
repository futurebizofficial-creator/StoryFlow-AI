// Regression: video_jobs INSERT must be limited to the four application columns.
// Reproduces production (restrictive default privileges + an out-of-band table-level INSERT
// grant to authenticated), shows the bypass, then applies 20261126000000 and verifies every column.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const dir = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const sql = (pred) => files.filter(pred).map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
assert.ok(files.includes("20261126000000_restrict_video_jobs_insert.sql"), "fix migration present");

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
  -- Production defaults: new public tables give anon/authenticated no data privileges.
  alter default privileges in schema public grant truncate, references, trigger on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
`);

const U = {
  owner: ["00000000-0000-0000-0000-0000000000a1", "owner@x.com"],
  member: ["00000000-0000-0000-0000-0000000000a3", "member@x.com"],
};
const ok = (label) => console.log(`✓ ${label}`);
async function as(user, query, params = []) {
  await db.exec("reset role");
  const claims = JSON.stringify({ sub: U[user][0], email: U[user][1], role: "authenticated" });
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
  await db.exec("set role authenticated");
  try {
    return await db.query(query, params);
  } finally {
    await db.exec("reset role");
  }
}

await db.exec(sql((f) => f < "20261123"));
for (const [id, email] of Object.values(U)) await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
const ws = (await as("owner", `select public.create_workspace('Studio') as id`)).rows[0].id;
await db.query(`insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')`, [ws, U.member[0]]);
await db.exec(sql((f) => f >= "20261123" && f < "20261126"));
const script = (await as("member", `insert into scripts (workspace_id, title, content, created_by) values ($1, 'S', 'A sufficiently long script body for rendering.', $2) returning id`, [ws, U.member[0]])).rows[0].id;

const REQUEST = JSON.stringify({ title: "T", script: "A sufficiently long script body for rendering.", orientation: "portrait" });
const ALLOWED = ["workspace_id", "script_id", "created_by", "request"];
const WORKER_OWNED = [
  ["id", "gen_random_uuid()"],
  ["status", "'completed'"],
  ["stage", "'completed'"],
  ["progress", "100"],
  ["attempts", "3"],
  ["output_url", "'x/y/video.mp4'"],
  ["engine_job_id", "'engine'"],
  ["visual_reference_path", "'x/y/ref.png'"],
  ["drive_file_url", "'https://drive.example/x'"],
  ["quality_report", "'{}'::jsonb"],
  ["error", "null"],
  ["locked_at", "now()"],
  ["created_at", "now()"],
  ["updated_at", "now()"],
  ["completed_at", "now()"],
];
const columns = (await db.query(`select attname from pg_attribute where attrelid = 'public.video_jobs'::regclass and attnum > 0 and not attisdropped`)).rows.map((r) => r.attname);
assert.deepEqual([...ALLOWED, ...WORKER_OWNED.map(([c]) => c)].sort(), [...columns].sort(), "every video_jobs column is classified");
const canInsert = async (role, col) => (await db.query(`select has_column_privilege($1, 'public.video_jobs', $2, 'INSERT') as v`, [role, col])).rows[0].v;
const tryForged = (col, value) =>
  as("member", `insert into video_jobs (workspace_id, script_id, created_by, request, ${col}) values ($1, $2, $3, $4::jsonb, ${value})`, [ws, script, U.member[0], REQUEST]);

// --- Reproduce production: an out-of-band table-level INSERT grant bypasses the column restriction.
await db.exec("grant insert on public.video_jobs to authenticated");
assert.equal(await canInsert("authenticated", "status"), true);
await tryForged("status", "'completed'");
ok("reproduced: with the table-level grant, members can insert worker-owned fields");
await db.exec("delete from public.video_jobs");

// --- Apply the fix.
await db.exec(sql((f) => f >= "20261126"));
ok("20261126000000_restrict_video_jobs_insert applies over the drifted privileges");

// --- Exact privileges after the fix.
const tablePriv = async (role, p) => (await db.query(`select has_table_privilege($1, 'public.video_jobs', $2) as v`, [role, p])).rows[0].v;
assert.equal(await tablePriv("authenticated", "INSERT"), false, "no table-level INSERT");
assert.equal(await tablePriv("authenticated", "UPDATE"), false);
assert.equal(await tablePriv("authenticated", "DELETE"), false);
assert.equal(await tablePriv("authenticated", "SELECT"), true, "members still read their jobs (RLS)");
for (const col of ALLOWED) assert.equal(await canInsert("authenticated", col), true, `${col} insertable`);
for (const [col] of WORKER_OWNED) assert.equal(await canInsert("authenticated", col), false, `${col} not insertable`);
for (const col of columns) assert.equal(await canInsert("anon", col), false, `anon cannot insert ${col}`);
assert.equal((await db.query(`select count(*)::int n from aclexplode((select relacl from pg_class where oid = 'public.video_jobs'::regclass)) where grantee = 0`)).rows[0].n, 0, "no PUBLIC grants");
ok("authenticated: SELECT + INSERT on exactly workspace_id, script_id, created_by, request; anon and PUBLIC: nothing");

assert.equal(await tablePriv("service_role", "SELECT"), true);
assert.equal(await tablePriv("service_role", "UPDATE"), true);
ok("service_role worker privileges (SELECT, UPDATE) preserved");
const policies = (await db.query(`select polname from pg_policy where polrelid = 'public.video_jobs'::regclass order by 1`)).rows.map((r) => r.polname);
assert.deepEqual(policies, ["video_jobs_create_members", "video_jobs_read_members"]);
ok("RLS policies unchanged");

// --- Behaviour: allowed insert works and starts from worker defaults; every forged field is denied.
const job = (await as("member", `insert into video_jobs (workspace_id, script_id, created_by, request) values ($1, $2, $3, $4::jsonb) returning id, status, progress, attempts, output_url`, [ws, script, U.member[0], REQUEST])).rows[0];
assert.deepEqual({ status: job.status, progress: job.progress, attempts: job.attempts, output_url: job.output_url }, { status: "queued", progress: 0, attempts: 0, output_url: null });
ok("members can queue a job with the four permitted columns; worker fields take defaults");
for (const [col, value] of WORKER_OWNED) {
  await assert.rejects(tryForged(col, value), /permission denied/, `${col} must be rejected`);
}
ok(`members cannot set any worker-owned column (${WORKER_OWNED.map(([c]) => c).join(", ")})`);
await assert.rejects(as("member", `update video_jobs set status = 'completed' where id = $1`, [job.id]), /permission denied/);
await assert.rejects(as("member", `delete from video_jobs where id = $1`, [job.id]), /permission denied/);
ok("members cannot update or delete jobs");
await assert.rejects(
  as("member", `insert into video_jobs (workspace_id, script_id, created_by, request) values ($1, $2, $3, $4::jsonb)`, [ws, script, U.owner[0], REQUEST]),
  /row-level security/,
);
ok("RLS still requires created_by = the caller");

// --- Idempotent: re-applying the fix keeps the same privileges.
await db.exec(sql((f) => f >= "20261126"));
assert.equal(await tablePriv("authenticated", "INSERT"), false);
for (const col of ALLOWED) assert.equal(await canInsert("authenticated", col), true);
ok("migration is idempotent");

console.log("\nAll video_jobs grant checks passed.");
