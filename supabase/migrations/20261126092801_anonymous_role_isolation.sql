-- Anonymous Supabase Auth users share PostgreSQL's authenticated role.
-- Never trust a mutable profile role to elevate an anonymous JWT to staff/admin.
create or replace function private.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
      then 'guest'::public.app_role
    else p.role
  end
  from public.profiles p
  where p.id = auth.uid() and p.is_active = true
  limit 1
$$;

-- Session membership is a guest-only capability. The receipt remains readable after close.
create or replace function private.is_session_member(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    and exists (
      select 1
      from public.session_members sm
      where sm.session_id = p_session_id
        and sm.user_id = auth.uid()
    )
$$;
