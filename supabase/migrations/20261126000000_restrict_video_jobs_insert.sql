-- Restore the column-level INSERT restriction on public.video_jobs.
--
-- Root cause: production had an explicit table-level INSERT grant on video_jobs for the
-- authenticated role (relacl `authenticated=arDxtm/postgres`). A table-level privilege covers
-- every column, so it overrode the intended column-level grant from 20261122000000 and let
-- signed-in users set worker-owned fields (status, progress, attempts, output_url, ...).
-- No repository migration grants it; it was added outside the migrations. No PUBLIC grant or
-- role membership is involved.
--
-- Fix: revoke table-level INSERT (this also clears all column-level INSERT grants), then
-- grant INSERT again on only the four application-supplied columns. UPDATE/DELETE stay
-- revoked for application roles. RLS policies and service_role worker privileges
-- (SELECT, UPDATE) are unchanged.

revoke insert on public.video_jobs from public, anon, authenticated;
revoke update, delete on public.video_jobs from public, anon, authenticated;

grant insert (workspace_id, script_id, created_by, request) on public.video_jobs to authenticated;
