-- FIRST ADMIN BOOTSTRAP
-- 1) In Supabase Dashboard -> Authentication -> Users, create and confirm the owner account.
-- 2) Replace the email below with the exact email of that account.
-- 3) Run this script once in the SQL Editor. It refuses to create a user or promote an anonymous account.
do $$
declare
  v_user_id uuid;
  v_email constant text := 'YOUR_OWNER_EMAIL@example.com';
begin
  select id into v_user_id
  from auth.users
  where lower(email) = lower(v_email)
    and is_anonymous = false
    and deleted_at is null
  limit 1;

  if v_user_id is null then
    raise exception 'No confirmed non-anonymous Auth user found for %. Create the owner account in Authentication -> Users first.', v_email;
  end if;

  insert into public.profiles (id, full_name, role, is_active)
  values (v_user_id, 'مدير المطعم', 'admin', true)
  on conflict (id) do update
    set role = 'admin',
        is_active = true,
        full_name = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name);
end;
$$;

-- Verify: must return exactly one row for the owner account.
select p.id, u.email, p.full_name, p.role, p.is_active
from public.profiles p
join auth.users u on u.id = p.id
where lower(u.email) = lower('YOUR_OWNER_EMAIL@example.com');
