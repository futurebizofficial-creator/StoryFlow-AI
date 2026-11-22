-- Persistent, tenant-scoped video jobs and user-owned provider credentials.
alter table public.scripts add constraint scripts_id_workspace_id_key unique (id, workspace_id);
create table public.video_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  script_id uuid not null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  stage text not null default 'queued',
  progress smallint not null default 0 check (progress between 0 and 100),
  request jsonb not null check (
    jsonb_typeof(request) = 'object'
    and char_length(coalesce(request ->> 'title', '')) between 1 and 160
    and char_length(coalesce(request ->> 'script', '')) between 10 and 4900
    and coalesce(request ->> 'orientation', 'portrait') in ('portrait', 'landscape')
  ),
  engine_job_id text,
  output_url text,
  visual_reference_path text,
  drive_file_url text,
  quality_report jsonb,
  error text,
  attempts smallint not null default 0,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (script_id, workspace_id) references public.scripts(id, workspace_id) on delete cascade
);
create index video_jobs_queue_idx on public.video_jobs(created_at) where status = 'queued';
create index video_jobs_workspace_idx on public.video_jobs(workspace_id, created_at desc);
create trigger video_jobs_updated_at before update on public.video_jobs
  for each row execute function public.set_updated_at();
alter table public.video_jobs enable row level security;
create policy "video_jobs_read_members" on public.video_jobs for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy "video_jobs_create_members" on public.video_jobs for insert to authenticated
  with check (public.is_workspace_member(workspace_id) and created_by = (select auth.uid()));
revoke update, delete on public.video_jobs from authenticated;
-- Members may only supply the job request; status, progress, attempts, output paths,
-- and engine fields are worker-owned and must start from their defaults.
revoke insert on public.video_jobs from authenticated;
grant insert (workspace_id, script_id, created_by, request) on public.video_jobs to authenticated;
grant select, update on public.video_jobs to service_role;

-- BYOK credentials are individually owned and encrypted by the application before storage.
create table public.workspace_provider_credentials (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('anthropic','gemini')),
  ciphertext text not null,
  nonce text not null,
  auth_tag text not null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id, provider)
);
alter table public.workspace_provider_credentials enable row level security;
create policy "provider_credentials_manage_own" on public.workspace_provider_credentials
  for all to authenticated using (user_id = (select auth.uid()) and public.is_workspace_member(workspace_id))
  with check (user_id = (select auth.uid()) and public.is_workspace_member(workspace_id));
grant select on public.workspace_provider_credentials to service_role;

-- Per-user Google Drive authorization. Tokens are ciphertext, never returned to clients.
create table public.google_drive_connections (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  ciphertext text not null,
  nonce text not null,
  auth_tag text not null,
  email text,
  connected_at timestamptz not null default now()
);
alter table public.google_drive_connections enable row level security;
create policy "drive_connection_read_own" on public.google_drive_connections for select to authenticated
  using (user_id = (select auth.uid()));
create policy "drive_connection_manage_own" on public.google_drive_connections for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select on public.google_drive_connections to service_role;

-- Workers claim jobs atomically; service_role is the only role granted execution.
create or replace function public.claim_video_job()
returns setof public.video_jobs
language plpgsql security definer set search_path = '' as $$
declare _job public.video_jobs;
begin
  update public.video_jobs set status = 'failed', stage = 'failed', error = 'Worker lease expired after maximum retries.', completed_at = now()
  where status = 'running' and locked_at < now() - interval '3 minutes' and attempts >= 3;
  select * into _job from public.video_jobs
  where (status = 'queued' or (status = 'running' and locked_at < now() - interval '3 minutes')) and attempts < 3
  order by created_at
  for update skip locked limit 1;
  if not found then return; end if;
  update public.video_jobs set status = 'running', stage = 'starting', progress = 2,
    attempts = attempts + 1, locked_at = now()
  where id = _job.id returning * into _job;
  return next _job;
end;
$$;
revoke all on function public.claim_video_job() from public, anon, authenticated;

-- Tables created after migration 1's blanket anon revoke inherit Supabase's default
-- anon grants; remove them so anonymous access is denied by privilege, not only by RLS.
revoke all on public.video_jobs, public.workspace_provider_credentials, public.google_drive_connections from anon;
grant execute on function public.claim_video_job() to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- Character references may come back from Gemini as PNG or JPEG; the worker uploads either.
values ('storyflow-videos', 'storyflow-videos', false, 524288000, array['video/mp4','image/png','image/jpeg','application/json'])
on conflict (id) do nothing;
grant select, insert, update on storage.objects to service_role;
create policy "workspace members read video artifacts" on storage.objects for select to authenticated
  using (bucket_id = 'storyflow-videos' and public.is_workspace_member((storage.foldername(name))[1]::uuid));
