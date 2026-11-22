-- Invite-only registration.
--
-- * New auth users are rejected unless their signup metadata carries a valid, pending,
--   unexpired member invitation addressed to the same email (BEFORE INSERT on auth.users).
-- * Owner privileges are limited to the accounts that are owners when this migration runs
--   (recorded in public.platform_owners). Nobody else can become an owner or create
--   workspaces, so invited members cannot bootstrap their own owner accounts.
-- * Only owners can create, see (as managers), revoke or delete invitations, and every
--   invitation is a member invitation. Only owners can change roles; nobody can grant owner.
--
-- Existing users, memberships, projects and scripts are not modified.

-- ---------------------------------------------------------------------------
-- Platform owners: the only accounts allowed to hold the owner role.
-- ---------------------------------------------------------------------------
create table public.platform_owners (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_owners enable row level security;
-- No policies: not readable or writable through the API. Managed only by migrations/SQL.
revoke all on public.platform_owners from anon, authenticated;

insert into public.platform_owners (user_id)
select distinct user_id from public.workspace_members where role = 'owner'
on conflict (user_id) do nothing;

-- Whether the signed-in caller is a platform owner (used by the UI to show owner-only actions).
create or replace function public.is_platform_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.platform_owners po where po.user_id = (select auth.uid()));
$$;

-- The owner role can only be held by platform owners, even for privileged/direct writes.
create or replace function public.guard_owner_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'owner'
     and (tg_op = 'INSERT' or old.role is distinct from 'owner')
     and not exists (select 1 from public.platform_owners po where po.user_id = new.user_id) then
    raise exception 'Only the platform owner account can hold the owner role' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger workspace_members_owner_role_guard
  before insert or update of role on public.workspace_members
  for each row execute function public.guard_owner_role();

-- ---------------------------------------------------------------------------
-- Invitations: member-only, owner-managed.
-- ---------------------------------------------------------------------------
-- NOT VALID: enforced for every new or updated row without rewriting existing ones.
alter table public.workspace_invitations
  add constraint workspace_invitations_member_only check (role = 'member') not valid;

drop policy if exists "invitations_select_admins_or_invitee" on public.workspace_invitations;
drop policy if exists "invitations_insert_admins" on public.workspace_invitations;
drop policy if exists "invitations_update_admins" on public.workspace_invitations;
drop policy if exists "invitations_delete_admins" on public.workspace_invitations;

create policy "invitations_select_owners_or_invitee" on public.workspace_invitations
  for select to authenticated
  using (
    public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[])
    or (status = 'pending' and email = public.current_user_email())
  );
create policy "invitations_insert_owners" on public.workspace_invitations
  for insert to authenticated
  with check (
    invited_by = (select auth.uid())
    and status = 'pending'
    and role = 'member'
    and public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[])
  );
create policy "invitations_update_owners" on public.workspace_invitations
  for update to authenticated
  using (public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[]))
  with check (
    status = 'revoked'
    and public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[])
  );
create policy "invitations_delete_owners" on public.workspace_invitations
  for delete to authenticated
  using (public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[]));

-- Accepting always grants the member role.
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

  if not found or _inv.status <> 'pending' or _inv.role <> 'member' then
    raise exception 'This invitation is no longer valid' using errcode = '22023';
  end if;
  if _inv.expires_at < now() then
    raise exception 'This invitation has expired' using errcode = '22023';
  end if;
  if _inv.email <> public.current_user_email() then
    raise exception 'This invitation was sent to a different email address' using errcode = '42501';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (_inv.workspace_id, _uid, 'member')
  on conflict (workspace_id, user_id) do nothing;

  update public.workspace_invitations
  set status = 'accepted', accepted_by = _uid, accepted_at = now()
  where id = _inv.id;

  return _inv.workspace_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Signup gate.
-- ---------------------------------------------------------------------------
-- Boolean-only pre-check for the signup page and action (callable before sign-in).
-- With _email null it reports whether the token is currently usable; with an email it also
-- requires the invitation to be addressed to that email. No invitation details are returned.
create or replace function public.signup_invitation_is_valid(_token uuid, _email text default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_invitations i
    where i.token = _token
      and i.status = 'pending'
      and i.role = 'member'
      and i.expires_at > now()
      and (_email is null or i.email = lower(trim(_email)))
  );
$$;

create or replace function public.enforce_invite_only_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _raw text := new.raw_user_meta_data ->> 'invitation_token';
  _token uuid;
begin
  if _raw is null or _raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Registration is by invitation only' using errcode = '42501';
  end if;
  _token := _raw::uuid;

  if new.email is null or not exists (
    select 1 from public.workspace_invitations i
    where i.token = _token
      and i.status = 'pending'
      and i.role = 'member'
      and i.expires_at > now()
      and i.email = lower(new.email)
  ) then
    raise exception 'Registration is by invitation only' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Runs before the existing AFTER INSERT on_auth_user_created profile trigger, which is unchanged.
create trigger enforce_invite_only_signup
  before insert on auth.users
  for each row execute function public.enforce_invite_only_signup();

-- ---------------------------------------------------------------------------
-- Workspace creation and role changes.
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
  if not exists (select 1 from public.platform_owners po where po.user_id = _uid) then
    raise exception 'Only the platform owner can create workspaces' using errcode = '42501';
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

  if _actor is distinct from 'owner' then
    raise exception 'Only owners can change roles' using errcode = '42501';
  end if;
  if _target is null then
    raise exception 'Member not found' using errcode = '22023';
  end if;
  if _user_id = _uid then
    raise exception 'You cannot change your own role' using errcode = '42501';
  end if;
  if _role = 'owner' then
    raise exception 'The owner role cannot be granted' using errcode = '42501';
  end if;

  update public.workspace_members set role = _role
  where workspace_id = _workspace_id and user_id = _user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges (new functions default to PUBLIC execute; restrict them).
-- ---------------------------------------------------------------------------
revoke all on function public.is_platform_owner() from public, anon;
revoke all on function public.guard_owner_role() from public, anon, authenticated;
revoke all on function public.enforce_invite_only_signup() from public, anon, authenticated;
revoke all on function public.signup_invitation_is_valid(uuid, text) from public;
revoke all on function public.accept_invitation(uuid) from public, anon;
revoke all on function public.create_workspace(text) from public, anon;
revoke all on function public.update_member_role(uuid, uuid, public.workspace_role) from public, anon;

grant execute on function public.is_platform_owner() to authenticated;
grant execute on function public.signup_invitation_is_valid(uuid, text) to anon, authenticated;
grant execute on function public.accept_invitation(uuid) to authenticated;
grant execute on function public.create_workspace(text) to authenticated;
grant execute on function public.update_member_role(uuid, uuid, public.workspace_role) to authenticated;
