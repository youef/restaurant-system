-- Persistent customer identity and cross-visit order history without SMS.
-- Phone + Hijri birth year is a convenience check, not strong identity proof.
create table if not exists public.customer_profiles (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null unique check (phone_e164 ~ '^[+]9665[0-9]{8}$'),
  birth_year_hijri smallint,
  auth_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_profiles_birth_year_check check (birth_year_hijri is null or birth_year_hijri between 1300 and 1500)
);
create index if not exists customer_profiles_auth_user_idx on public.customer_profiles(auth_user_id) where auth_user_id is not null;
alter table public.customer_profiles enable row level security;
revoke all on public.customer_profiles from anon, authenticated;

create table if not exists private.customer_identity_attempts (
  phone_e164 text primary key,
  attempts integer not null default 0,
  window_started_at timestamptz not null default now(),
  locked_until timestamptz
);
revoke all on private.customer_identity_attempts from public, anon, authenticated;

insert into public.customer_profiles(phone_e164, auth_user_id)
select distinct on (phone_e164) phone_e164, user_id
from public.customer_contacts order by phone_e164, created_at
on conflict (phone_e164) do nothing;

alter table public.orders add column if not exists customer_id uuid references public.customer_profiles(id) on delete set null;
create index if not exists orders_customer_placed_idx on public.orders(customer_id, placed_at desc) where customer_id is not null;
update public.orders o set customer_id = cp.id
from public.customer_contacts cc join public.customer_profiles cp on cp.phone_e164 = cc.phone_e164
where o.placed_by = cc.user_id and o.customer_id is null;

create or replace function private.is_customer_order_owner(p_customer_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public
as $$
  select p_customer_id is not null and exists (
    select 1 from public.customer_profiles cp where cp.id = p_customer_id and cp.auth_user_id = auth.uid()
  )
$$;
revoke all on function private.is_customer_order_owner(uuid) from public, anon;
grant execute on function private.is_customer_order_owner(uuid) to authenticated;

create or replace function public.claim_customer_profile(p_phone_e164 text, p_birth_year_hijri integer)
returns table(customer_id uuid, verified boolean, error_code text)
language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare
  v_profile public.customer_profiles%rowtype;
  v_attempts private.customer_identity_attempts%rowtype;
  v_phone text := trim(coalesce(p_phone_e164, ''));
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is not true
     or private.current_app_role() is distinct from 'guest' then
    raise exception 'هذه العملية متاحة لجلسة عميل فقط' using errcode = '42501';
  end if;
  if v_phone !~ '^[+]9665[0-9]{8}$' or p_birth_year_hijri is null
     or p_birth_year_hijri < 1300 or p_birth_year_hijri > 1500 then
    return query select null::uuid, false, 'invalid_input'::text; return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_phone, 0));
  select * into v_attempts from private.customer_identity_attempts where phone_e164 = v_phone for update;
  if found and v_attempts.locked_until is not null and v_attempts.locked_until > now() then
    return query select null::uuid, false, 'temporarily_locked'::text; return;
  end if;
  select * into v_profile from public.customer_profiles where phone_e164 = v_phone for update;
  if not found then
    insert into public.customer_profiles(phone_e164, birth_year_hijri, auth_user_id)
    values (v_phone, p_birth_year_hijri::smallint, auth.uid()) returning * into v_profile;
  elsif v_profile.birth_year_hijri is null then
    update public.customer_profiles set birth_year_hijri = p_birth_year_hijri::smallint,
      auth_user_id = auth.uid(), updated_at = now() where id = v_profile.id returning * into v_profile;
  elsif v_profile.birth_year_hijri <> p_birth_year_hijri::smallint then
    insert into private.customer_identity_attempts(phone_e164, attempts, window_started_at, locked_until)
    values (v_phone, 1, now(), null)
    on conflict (phone_e164) do update
    set attempts = case when private.customer_identity_attempts.window_started_at < now() - interval '15 minutes'
      then 1 else private.customer_identity_attempts.attempts + 1 end,
      window_started_at = case when private.customer_identity_attempts.window_started_at < now() - interval '15 minutes'
      then now() else private.customer_identity_attempts.window_started_at end,
      locked_until = case when (case
        when private.customer_identity_attempts.window_started_at < now() - interval '15 minutes' then 1
        else private.customer_identity_attempts.attempts + 1 end) >= 5
        then now() + interval '15 minutes' else null end;
    return query select null::uuid, false, 'identity_mismatch'::text; return;
  else
    update public.customer_profiles set auth_user_id = auth.uid(), updated_at = now()
    where id = v_profile.id returning * into v_profile;
  end if;
  delete from private.customer_identity_attempts where phone_e164 = v_phone;
  return query select v_profile.id, true, null::text;
end;
$$;
revoke all on function public.claim_customer_profile(text, integer) from public, anon;
grant execute on function public.claim_customer_profile(text, integer) to authenticated;

create or replace function private.attach_customer_to_order()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  if private.current_app_role() = 'guest' then
    select cp.id into new.customer_id from public.customer_profiles cp
    where cp.auth_user_id = auth.uid() order by cp.updated_at desc limit 1;
  end if;
  return new;
end;
$$;
revoke all on function private.attach_customer_to_order() from public, anon, authenticated;
drop trigger if exists orders_attach_customer on public.orders;
create trigger orders_attach_customer before insert on public.orders
for each row execute function private.attach_customer_to_order();

drop policy if exists orders_guest_own_rows_only on public.orders;
create policy orders_guest_own_rows_only on public.orders as restrictive for select to authenticated
using (private.current_app_role() <> 'guest' or
  ((private.is_session_member(session_id) and placed_by = (select auth.uid()))
   or private.is_customer_order_owner(customer_id)));

drop policy if exists order_items_guest_own_rows_only on public.order_items;
create policy order_items_guest_own_rows_only on public.order_items as restrictive for select to authenticated
using (private.current_app_role() <> 'guest' or exists (
  select 1 from public.orders o where o.id = order_items.order_id and
    ((private.is_session_member(o.session_id) and o.placed_by = (select auth.uid()))
     or private.is_customer_order_owner(o.customer_id))
));

drop policy if exists orders_customer_history_select on public.orders;
create policy orders_customer_history_select on public.orders for select to authenticated
using (private.current_app_role() = 'guest' and private.is_customer_order_owner(customer_id));

drop policy if exists order_items_customer_history_select on public.order_items;
create policy order_items_customer_history_select on public.order_items for select to authenticated
using (private.current_app_role() = 'guest' and exists (
  select 1 from public.orders o where o.id = order_items.order_id
    and private.is_customer_order_owner(o.customer_id)
));
