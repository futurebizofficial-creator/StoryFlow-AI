-- Integrations Hub.
--
-- * Users can store encrypted keys for more providers (same table, same AES-GCM envelope,
--   same per-user + per-workspace RLS). Existing anthropic/gemini keys are untouched.
-- * Owners/admins can enable or disable any catalog provider per workspace
--   (workspace_integrations, existing policies).
-- * New workspace_generation_settings: Free Mode, scene-planning provider order and models.
--   Members read; owners/admins write.
--
-- Provider ids mirror src/lib/integrations/catalog.json.

-- ---------------------------------------------------------------------------
-- Allowed provider ids (replace the old check constraints by definition, not by name).
-- ---------------------------------------------------------------------------
do $$
declare
  _c record;
begin
  for _c in
    select conname from pg_constraint
    where conrelid = 'public.workspace_provider_credentials'::regclass
      and contype = 'c' and pg_get_constraintdef(oid) like '%provider%'
  loop
    execute format('alter table public.workspace_provider_credentials drop constraint %I', _c.conname);
  end loop;
  for _c in
    select conname from pg_constraint
    where conrelid = 'public.workspace_integrations'::regclass
      and contype = 'c' and pg_get_constraintdef(oid) like '%provider%'
  loop
    execute format('alter table public.workspace_integrations drop constraint %I', _c.conname);
  end loop;
end;
$$;

alter table public.workspace_provider_credentials
  add constraint workspace_provider_credentials_provider_check check (provider in (
    'gemini', 'openai', 'anthropic', 'huggingface', 'groq', 'mistral', 'deepseek', 'together', 'replicate',
    'elevenlabs', 'google_tts', 'pexels', 'pixabay', 'unsplash'
  ));

alter table public.workspace_integrations
  add constraint workspace_integrations_provider_check check (provider in (
    'gemini', 'openai', 'anthropic', 'huggingface', 'groq', 'mistral', 'deepseek', 'together', 'replicate',
    'elevenlabs', 'google_tts', 'avg_voices', 'avg_audio',
    'pexels', 'pixabay', 'unsplash', 'wikimedia', 'internet_archive',
    'capcut', 'canva', 'mixkit',
    'youtube', 'tiktok', 'pinterest',
    'google_drive', 'supabase_storage',
    'webhook'
  ));

-- ---------------------------------------------------------------------------
-- Video generation preferences per workspace.
-- ---------------------------------------------------------------------------
create table public.workspace_generation_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  -- Free Mode: only free / free-tier providers, never a paid fallback.
  free_mode boolean not null default false,
  -- Scene-planning providers in fallback order (first = default primary).
  ai_providers text[] not null default array['anthropic']
    check (
      cardinality(ai_providers) between 1 and 4
      and ai_providers <@ array['gemini', 'openai', 'anthropic', 'huggingface', 'groq', 'mistral', 'deepseek', 'together']::text[]
    ),
  -- Model id per provider, e.g. {"groq": "<model id>"}.
  ai_models jsonb not null default '{}'::jsonb check (jsonb_typeof(ai_models) = 'object'),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create trigger workspace_generation_settings_updated_at
  before update on public.workspace_generation_settings
  for each row execute function public.set_updated_at();
create trigger workspace_generation_settings_lock_workspace
  before update on public.workspace_generation_settings
  for each row execute function public.prevent_workspace_change();

alter table public.workspace_generation_settings enable row level security;

create policy "generation_settings_select_members" on public.workspace_generation_settings
  for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy "generation_settings_insert_admins" on public.workspace_generation_settings
  for insert to authenticated
  with check (
    public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
    and updated_by = (select auth.uid())
  );
create policy "generation_settings_update_admins" on public.workspace_generation_settings
  for update to authenticated
  using (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]))
  with check (
    public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
    and updated_by = (select auth.uid())
  );

revoke all on public.workspace_generation_settings from anon;
revoke delete on public.workspace_generation_settings from authenticated;
grant select on public.workspace_generation_settings to service_role;
grant select on public.workspace_integrations to service_role;
