-- A customer can immediately release an unused table; visits with orders still require staff settlement.
create or replace function private.request_customer_exit(p_session_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_customer_id uuid;
  v_session public.table_sessions%rowtype;
  v_request_id uuid;
begin
  if auth.uid() is null
     or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is not true
     or private.current_app_role() is distinct from 'guest' then
    raise exception 'هذه العملية متاحة لجلسة العميل فقط' using errcode = '42501';
  end if;

  select cp.id into v_customer_id
    from public.customer_profiles cp
   where cp.auth_user_id = auth.uid();
  if v_customer_id is null then
    raise exception 'أكمل التحقق من بيانات العميل أولاً' using errcode = '42501';
  end if;

  select * into v_session
    from public.table_sessions ts
   where ts.id = p_session_id and ts.status = 'open'
     and (ts.customer_id = v_customer_id
          or exists (select 1 from public.session_members sm
                      where sm.session_id = ts.id and sm.user_id = auth.uid()))
   for update;
  if not found then
    raise exception 'الزيارة مغلقة أو لا تملك صلاحية إنهائها' using errcode = 'P0002';
  end if;

  if v_session.customer_exit_requested_at is null then
    insert into public.customer_session_events(session_id, customer_id, auth_user_id, event_type)
    values (p_session_id, v_customer_id, auth.uid(), 'exit_requested');
  end if;

  if not exists (select 1 from public.orders o where o.session_id = p_session_id) then
    update public.table_sessions
       set customer_exit_requested_at = coalesce(customer_exit_requested_at, now()),
           status = 'closed', closed_at = now(), reservation_expires_at = null
     where id = p_session_id;
    update public.restaurant_tables
       set status = 'available'
     where id = v_session.table_id and status <> 'out_of_service';
    return null;
  end if;

  update public.table_sessions
     set customer_exit_requested_at = coalesce(customer_exit_requested_at, now())
   where id = p_session_id;

  select br.id into v_request_id
    from public.bill_requests br
   where br.session_id = p_session_id and br.status in ('requested', 'acknowledged')
   order by br.requested_at desc limit 1;
  if v_request_id is null then
    insert into public.bill_requests(session_id)
    values (p_session_id)
    returning id into v_request_id;
  end if;
  return v_request_id;
end;
$$;
revoke all on function private.request_customer_exit(uuid) from public, anon, authenticated;
grant execute on function private.request_customer_exit(uuid) to authenticated;

create or replace function public.request_customer_exit(p_session_id uuid)
returns uuid
language sql
security invoker
set search_path = pg_catalog, public, private
as $$ select private.request_customer_exit(p_session_id) $$;
revoke all on function public.request_customer_exit(uuid) from public, anon;
grant execute on function public.request_customer_exit(uuid) to authenticated;
