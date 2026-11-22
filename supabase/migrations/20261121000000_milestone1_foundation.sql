-- StoryFlow AI — Milestone 1 foundation
-- Workspaces, membership & roles, invitations, projects, scripts, integration settings.
-- All tables are protected by Row Level Security. Membership mutations go through
-- SECURITY DEFINER functions that enforce the role hierarchy in the database.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.workspace_role as enum ('owner', 'admin', 'member');
create type public.invitation_status as enum ('pending', 'accepted', 'revoked');
create type public.project_status as enum ('draft', 'in_progress', 'review', 'completed', 'archived');
create type public.script_status as enum ('draft', 'in_review', 'approved');

-- ---------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.prevent_workspace_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'workspace_id cannot be changed';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text check (full_name is null or char_length(full_name) <= 120),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    lower(new.email),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = lower(new.email) where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

-- ---------------------------------------------------------------------------
-- Workspaces & membership
-- ---------------------------------------------------------------------------
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 64),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger workspaces_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.workspace_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_id_idx on public.workspace_members (user_id);

create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.workspace_role not null default 'member' check (role <> 'owner'),
  token uuid not null unique default gen_random_uuid(),
  status public.invitation_status not null default 'pending',
  invited_by uuid references public.profiles (id) on delete set null,
  accepted_by uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);

create unique index workspace_invitations_pending_unique
  on public.workspace_invitations (workspace_id, email)
  where status = 'pending';
create index workspace_invitations_email_idx on public.workspace_invitations (email);

-- ---------------------------------------------------------------------------
-- Authorization helpers (SECURITY DEFINER avoids recursive RLS evaluation)
-- ---------------------------------------------------------------------------
create or replace function public.is_workspace_member(_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = _workspace_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_workspace_role(_workspace_id uuid, _roles public.workspace_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = _workspace_id
      and m.user_id = (select auth.uid())
      and m.role = any (_roles)
  );
$$;

create or replace function public.shares_workspace_with(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members mine
    join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = _user_id
  );
$$;

create or replace function public.current_user_email()
returns text
language sql
stable
set search_path = ''
as $$
  select lower(coalesce((select auth.jwt()) ->> 'email', ''));
$$;

-- ---------------------------------------------------------------------------
-- Projects & scripts
-- ---------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  description text check (description is null or char_length(description) <= 2000),
  status public.project_status not null default 'draft',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);

create index projects_workspace_id_idx on public.projects (workspace_id, updated_at desc);

create trigger projects_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();
create trigger projects_lock_workspace
  before update on public.projects
  for each row execute function public.prevent_workspace_change();

create table public.scripts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid,
  title text not null check (char_length(trim(title)) between 1 and 160),
  content text not null default '' check (char_length(content) <= 100000),
  format text not null default 'short_form' check (format in ('short_form', 'long_form', 'ad', 'explainer', 'story')),
  tone text not null default 'conversational' check (char_length(tone) <= 40),
  target_duration_seconds integer not null default 60 check (target_duration_seconds between 5 and 7200),
  status public.script_status not null default 'draft',
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A script can only be attached to a project in the same workspace.
  foreign key (project_id, workspace_id)
    references public.projects (id, workspace_id)
    on delete set null (project_id)
);

create index scripts_workspace_id_idx on public.scripts (workspace_id, updated_at desc);
create index scripts_project_id_idx on public.scripts (project_id);

create trigger scripts_updated_at
  before update on public.scripts
  for each row execute function public.set_updated_at();
create trigger scripts_lock_workspace
  before update on public.scripts
  for each row execute function public.prevent_workspace_change();

-- ---------------------------------------------------------------------------
-- Integration settings (non-secret, per workspace). API keys are never stored here.
-- ---------------------------------------------------------------------------
create table public.workspace_integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider text not null check (provider in ('openai', 'anthropic', 'elevenlabs', 'youtube', 'webhook')),
  enabled boolean not null default false,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider)
);

create trigger workspace_integrations_updated_at
  before update on public.workspace_integrations
  for each row execute function public.set_updated_at();
create trigger workspace_integrations_lock_workspace
  before update on public.workspace_integrations
  for each row execute function public.prevent_workspace_change();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invitations enable row level security;
alter table public.projects enable row level security;
alter table public.scripts enable row level security;
alter table public.workspace_integrations enable row level security;

-- Profiles: yourself and people you share a workspace with.
create policy "profiles_select_self_or_teammates" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.shares_workspace_with(id));
create policy "profiles_update_self" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Workspaces: members read; owners/admins rename; owners delete. Creation via create_workspace().
create policy "workspaces_select_members" on public.workspaces
  for select to authenticated
  using (public.is_workspace_member(id));
create policy "workspaces_update_admins" on public.workspaces
  for update to authenticated
  using (public.has_workspace_role(id, array['owner', 'admin']::public.workspace_role[]))
  with check (public.has_workspace_role(id, array['owner', 'admin']::public.workspace_role[]));
create policy "workspaces_delete_owners" on public.workspaces
  for delete to authenticated
  using (public.has_workspace_role(id, array['owner']::public.workspace_role[]));

-- Members: visible to fellow members. All writes go through role-checked functions.
create policy "members_select_same_workspace" on public.workspace_members
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- Invitations: owners/admins manage; the invitee can see invitations addressed to them.
create policy "invitations_select_admins_or_invitee" on public.workspace_invitations
  for select to authenticated
  using (
    public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
    or (status = 'pending' and email = public.current_user_email())
  );
create policy "invitations_insert_admins" on public.workspace_invitations
  for insert to authenticated
  with check (
    invited_by = (select auth.uid())
    and status = 'pending'
    and (
      (role = 'admin' and public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[]))
      or (role = 'member' and public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]))
    )
  );
create policy "invitations_update_admins" on public.workspace_invitations
  for update to authenticated
  using (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]))
  with check (
    status = 'revoked'
    and public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
  );
create policy "invitations_delete_admins" on public.workspace_invitations
  for delete to authenticated
  using (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));

-- Projects
create policy "projects_select_members" on public.projects
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "projects_insert_members" on public.projects
  for insert to authenticated
  with check (public.is_workspace_member(workspace_id) and created_by = (select auth.uid()));
create policy "projects_update_members" on public.projects
  for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
create policy "projects_delete_admins_or_creator" on public.projects
  for delete to authenticated
  using (
    public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
    or (created_by = (select auth.uid()) and public.is_workspace_member(workspace_id))
  );

-- Scripts
create policy "scripts_select_members" on public.scripts
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "scripts_insert_members" on public.scripts
  for insert to authenticated
  with check (public.is_workspace_member(workspace_id) and created_by = (select auth.uid()));
create policy "scripts_update_members" on public.scripts
  for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
create policy "scripts_delete_admins_or_creator" on public.scripts
  for delete to authenticated
  using (
    public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
    or (created_by = (select auth.uid()) and public.is_workspace_member(workspace_id))
  );

-- Integration settings: members read, owners/admins write.
create policy "integrations_select_members" on public.workspace_integrations
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "integrations_insert_admins" on public.workspace_integrations
  for insert to authenticated
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));
create policy "integrations_update_admins" on public.workspace_integrations
  for update to authenticated
  using (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]))
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));
create policy "integrations_delete_admins" on public.workspace_integrations
  for delete to authenticated
  using (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));

-- ---------------------------------------------------------------------------
-- Privileges: nothing for anonymous users; restrict mutable columns.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;

revoke insert, update, delete on public.workspace_members from authenticated;
revoke insert on public.workspaces from authenticated;
revoke insert, delete on public.profiles from authenticated;

revoke update on public.profiles from authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;

revoke update on public.workspaces from authenticated;
grant update (name) on public.workspaces to authenticated;

revoke update on public.workspace_invitations from authenticated;
grant update (status) on public.workspace_invitations to authenticated;

-- ---------------------------------------------------------------------------
-- Workspace & membership functions
-- ---------------------------------------------------------------------------
create or replace function public.create_workspace(_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := (select auth.uid());
  _clean text := trim(_name);
  _base text;
  _workspace_id uuid;
begin
  if _uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if char_length(_clean) < 2 or char_length(_clean) > 64 then
    raise exception 'Workspace name must be between 2 and 64 characters' using errcode = '22023';
  end if;

  _base := trim(both '-' from regexp_replace(lower(_clean), '[^a-z0-9]+', '-', 'g'));
  if _base = '' then
    _base := 'workspace';
  end if;
  _base := left(_base, 40);

  insert into public.workspaces (name, slug, created_by)
  values (_clean, _base || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6), _uid)
  returning id into _workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (_workspace_id, _uid, 'owner');

  return _workspace_id;
end;
$$;

create or replace function public.accept_invitation(_token uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := (select auth.uid());
  _inv public.workspace_invitations%rowtype;
begin
  if _uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into _inv from public.workspace_invitations where token = _token for update;

  if not found or _inv.status <> 'pending' then
    raise exception 'This invitation is no longer valid' using errcode = '22023';
  end if;
  if _inv.expires_at < now() then
    raise exception 'This invitation has expired' using errcode = '22023';
  end if;
  if _inv.email <> public.current_user_email() then
    raise exception 'This invitation was sent to a different email address' using errcode = '42501';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (_inv.workspace_id, _uid, _inv.role)
  on conflict (workspace_id, user_id) do nothing;

  update public.workspace_invitations
  set status = 'accepted', accepted_by = _uid, accepted_at = now()
  where id = _inv.id;

  return _inv.workspace_id;
end;
$$;

create or replace function public.get_invitation(_token uuid)
returns table (
  workspace_id uuid,
  workspace_name text,
  email text,
  role public.workspace_role,
  status public.invitation_status,
  expires_at timestamptz,
  invited_by_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.workspace_id, w.name, i.email, i.role, i.status, i.expires_at,
         coalesce(p.full_name, p.email)
  from public.workspace_invitations i
  join public.workspaces w on w.id = i.workspace_id
  left join public.profiles p on p.id = i.invited_by
  where i.token = _token
    and (select auth.uid()) is not null;
$$;

create or replace function public.my_pending_invitations()
returns table (
  token uuid,
  workspace_name text,
  role public.workspace_role,
  invited_by_name text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.token, w.name, i.role, coalesce(p.full_name, p.email), i.expires_at
  from public.workspace_invitations i
  join public.workspaces w on w.id = i.workspace_id
  left join public.profiles p on p.id = i.invited_by
  where i.status = 'pending'
    and i.expires_at > now()
    and i.email = public.current_user_email()
    and not exists (
      select 1 from public.workspace_members m
      where m.workspace_id = i.workspace_id and m.user_id = (select auth.uid())
    )
  order by i.created_at desc;
$$;

create or replace function public.update_member_role(_workspace_id uuid, _user_id uuid, _role public.workspace_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := (select auth.uid());
  _actor public.workspace_role;
  _target public.workspace_role;
begin
  select role into _actor from public.workspace_members where workspace_id = _workspace_id and user_id = _uid;
  select role into _target from public.workspace_members where workspace_id = _workspace_id and user_id = _user_id for update;

  if _actor is null or _actor = 'member' then
    raise exception 'You do not have permission to change roles' using errcode = '42501';
  end if;
  if _target is null then
    raise exception 'Member not found' using errcode = '22023';
  end if;
  if _user_id = _uid then
    raise exception 'You cannot change your own role' using errcode = '42501';
  end if;
  if _actor = 'admin' and (_target = 'owner' or _role = 'owner') then
    raise exception 'Only owners can manage owner roles' using errcode = '42501';
  end if;

  update public.workspace_members set role = _role
  where workspace_id = _workspace_id and user_id = _user_id;
end;
$$;

create or replace function public.remove_member(_workspace_id uuid, _user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := (select auth.uid());
  _actor public.workspace_role;
  _target public.workspace_role;
  _owner_count integer;
begin
  select role into _actor from public.workspace_members where workspace_id = _workspace_id and user_id = _uid;
  select role into _target from public.workspace_members where workspace_id = _workspace_id and user_id = _user_id for update;

  if _actor is null then
    raise exception 'You are not a member of this workspace' using errcode = '42501';
  end if;
  if _target is null then
    raise exception 'Member not found' using errcode = '22023';
  end if;

  if _user_id <> _uid then
    if _actor = 'member' then
      raise exception 'You do not have permission to remove members' using errcode = '42501';
    end if;
    if _actor = 'admin' and _target <> 'member' then
      raise exception 'Admins can only remove members' using errcode = '42501';
    end if;
  end if;

  if _target = 'owner' then
    select count(*) into _owner_count from public.workspace_members
    where workspace_id = _workspace_id and role = 'owner';
    if _owner_count <= 1 then
      raise exception 'A workspace must keep at least one owner' using errcode = '22023';
    end if;
  end if;

  delete from public.workspace_members where workspace_id = _workspace_id and user_id = _user_id;
end;
$$;

-- Guarantee at least one owner even for direct/privileged updates.
create or replace function public.ensure_owner_remains()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') then
    if exists (select 1 from public.workspaces w where w.id = old.workspace_id)
       and not exists (
         select 1 from public.workspace_members m
         where m.workspace_id = old.workspace_id and m.role = 'owner'
           and m.user_id <> old.user_id
       ) then
      raise exception 'A workspace must keep at least one owner' using errcode = '22023';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger workspace_members_owner_guard
  before update or delete on public.workspace_members
  for each row execute function public.ensure_owner_remains();

-- Functions are executable by PUBLIC by default; restrict them to signed-in users.
revoke all on all functions in schema public from public, anon;

grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.has_workspace_role(uuid, public.workspace_role[]) to authenticated;
grant execute on function public.shares_workspace_with(uuid) to authenticated;
grant execute on function public.current_user_email() to authenticated;
grant execute on function public.create_workspace(text) to authenticated;
grant execute on function public.accept_invitation(uuid) to authenticated;
grant execute on function public.get_invitation(uuid) to authenticated;
grant execute on function public.my_pending_invitations() to authenticated;
grant execute on function public.update_member_role(uuid, uuid, public.workspace_role) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
