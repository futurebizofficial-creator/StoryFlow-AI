-- Explicit Data API privileges for the authenticated role.
--
-- Root cause: this Supabase project's default privileges for new public tables give
-- `authenticated` only TRUNCATE/REFERENCES/TRIGGER/MAINTAIN — not SELECT/INSERT/UPDATE/DELETE.
-- Tables without explicit grants were therefore unreachable from the app even though their
-- RLS policies were correct (e.g. workspace_generation_settings could not be read or saved,
-- workspace_invitations could not be created or listed).
--
-- These grants only restore the table-level access the existing RLS policies were written for.
-- Row-level security still decides which rows each user can see or change. Privileges that
-- earlier migrations deliberately withheld (workspace/profile inserts, membership writes,
-- worker-owned video_jobs columns, platform_owners) are not granted.

-- Profiles: read; update own name/avatar only (insert/delete handled by auth triggers).
grant select on public.profiles to authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;

-- Workspaces: read; rename; owners delete. Creation only via create_workspace().
grant select, delete on public.workspaces to authenticated;
grant update (name) on public.workspaces to authenticated;

-- Membership: read only. Writes go through role-checked functions.
grant select on public.workspace_members to authenticated;

-- Invitations: owners create/list/revoke/delete (RLS); invitees read their own pending ones.
grant select, insert, delete on public.workspace_invitations to authenticated;
grant update (status) on public.workspace_invitations to authenticated;

-- Workspace content.
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.scripts to authenticated;
grant select, insert, update, delete on public.workspace_integrations to authenticated;

-- Per-user encrypted credentials and Drive connections (RLS: own rows only).
grant select, insert, update, delete on public.workspace_provider_credentials to authenticated;
grant select, insert, update, delete on public.google_drive_connections to authenticated;

-- Video jobs: read; insert only the four application fields (worker owns the rest).
grant select on public.video_jobs to authenticated;
grant insert (workspace_id, script_id, created_by, request) on public.video_jobs to authenticated;

-- Generation settings: members read; owners/admins insert/update (RLS). No deletes.
grant select, insert, update on public.workspace_generation_settings to authenticated;
