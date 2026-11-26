-- Keep the exposed RPC invoker-only; place privileged identity lookup in private schema.
create or replace function private.claim_customer_profile(p_phone_e164 text, p_birth_year_hijri integer)
returns table(customer_id uuid, verified boolean, error_code text)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_profile public.customer_profiles%rowtype;
  v_attempts private.customer_identity_attempts%rowtype;
  v_profile_found boolean := false;
  v_phone text := trim(coalesce(p_phone_e164, ''));
begin
  if auth.uid() is null
     or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is not true
     or private.current_app_role() is distinct from 'guest' then
    raise exception 'هذه العملية متاحة لجلسة العميل فقط' using errcode = '42501';
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
  v_profile_found := found;
  if v_profile_found and v_profile.birth_year_hijri is not null
     and v_profile.birth_year_hijri <> p_birth_year_hijri::smallint then
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
  end if;
  update public.customer_profiles set auth_user_id = null, updated_at = now()
   where auth_user_id = auth.uid() and phone_e164 <> v_phone;
  if not v_profile_found then
    insert into public.customer_profiles(phone_e164, birth_year_hijri, auth_user_id)
    values (v_phone, p_birth_year_hijri::smallint, auth.uid()) returning * into v_profile;
  else
    update public.customer_profiles set auth_user_id = auth.uid(), updated_at = now()
     where id = v_profile.id returning * into v_profile;
  end if;
  delete from private.customer_identity_attempts where phone_e164 = v_phone;
  return query select v_profile.id, true, null::text;
end;
$$;
revoke all on function private.claim_customer_profile(text, integer) from public, anon;
grant execute on function private.claim_customer_profile(text, integer) to authenticated;

create or replace function public.claim_customer_profile(p_phone_e164 text, p_birth_year_hijri integer)
returns table(customer_id uuid, verified boolean, error_code text)
language sql
security invoker
set search_path = pg_catalog, public, private
as $$ select * from private.claim_customer_profile(p_phone_e164, p_birth_year_hijri) $$;
revoke all on function public.claim_customer_profile(text, integer) from public, anon;
grant execute on function public.claim_customer_profile(text, integer) to authenticated;
