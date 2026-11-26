-- Customer logout audit and explicit table-exit request workflow.
alter table public.table_sessions
  add column if not exists customer_exit_requested_at timestamptz;

create table if not exists public.customer_session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.table_sessions(id) on delete set null,
  customer_id uuid references public.customer_profiles(id) on delete set null,
  auth_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in ('logout', 'exit_requested', 'session_closed')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists customer_session_events_customer_created_idx on public.customer_session_events(customer_id, created_at desc);
create index if not exists customer_session_events_session_created_idx on public.customer_session_events(session_id, created_at desc);
alter table public.customer_session_events enable row level security;
revoke all on public.customer_session_events from public, anon, authenticated;

create or replace function private.record_customer_logout(p_session_id uuid default null)
returns void language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare v_customer_id uuid;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is not true
     or private.current_app_role() is distinct from 'guest' then
    raise exception 'هذه العملية متاحة لجلسة العميل فقط' using errcode = '42501';
  end if;
  select cp.id into v_customer_id from public.customer_profiles cp where cp.auth_user_id = auth.uid();
  if v_customer_id is null then raise exception 'تعذر تحديد ملف العميل' using errcode = '42501'; end if;
  if p_session_id is not null and not exists (
    select 1 from public.table_sessions ts where ts.id = p_session_id
      and (ts.customer_id = v_customer_id or exists (
        select 1 from public.session_members sm where sm.session_id = ts.id and sm.user_id = auth.uid()))
  ) then raise exception 'لا تملك صلاحية تسجيل الخروج من هذه الزيارة' using errcode = '42501'; end if;
  insert into public.customer_session_events(session_id, customer_id, auth_user_id, event_type)
  values (p_session_id, v_customer_id, auth.uid(), 'logout');
end; $$;
revoke all on function private.record_customer_logout(uuid) from public, anon, authenticated;
grant execute on function private.record_customer_logout(uuid) to authenticated;
create or replace function public.record_customer_logout(p_session_id uuid default null)
returns void language sql security invoker set search_path = pg_catalog, public, private
as $$ select private.record_customer_logout(p_session_id) $$;
revoke all on function public.record_customer_logout(uuid) from public, anon;
grant execute on function public.record_customer_logout(uuid) to authenticated;

create or replace function private.request_customer_exit(p_session_id uuid)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare v_customer_id uuid; v_session public.table_sessions%rowtype; v_request_id uuid;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is not true
     or private.current_app_role() is distinct from 'guest' then
    raise exception 'هذه العملية متاحة لجلسة العميل فقط' using errcode = '42501';
  end if;
  select cp.id into v_customer_id from public.customer_profiles cp where cp.auth_user_id = auth.uid();
  if v_customer_id is null then raise exception 'أكمل التحقق من بيانات العميل أولاً' using errcode = '42501'; end if;
  select * into v_session from public.table_sessions ts
   where ts.id = p_session_id and ts.status = 'open'
     and (ts.customer_id = v_customer_id or exists (
       select 1 from public.session_members sm where sm.session_id = ts.id and sm.user_id = auth.uid()))
   for update;
  if not found then raise exception 'الزيارة مغلقة أو لا تملك صلاحية إنهائها' using errcode = 'P0002'; end if;
  if v_session.customer_exit_requested_at is null then
    update public.table_sessions set customer_exit_requested_at = now() where id = p_session_id;
    insert into public.customer_session_events(session_id, customer_id, auth_user_id, event_type)
    values (p_session_id, v_customer_id, auth.uid(), 'exit_requested');
  end if;
  select br.id into v_request_id from public.bill_requests br
   where br.session_id = p_session_id and br.status in ('requested', 'acknowledged')
   order by br.requested_at desc limit 1;
  if v_request_id is null then
    insert into public.bill_requests(session_id) values (p_session_id) returning id into v_request_id;
  end if;
  return v_request_id;
end; $$;
revoke all on function private.request_customer_exit(uuid) from public, anon, authenticated;
grant execute on function private.request_customer_exit(uuid) to authenticated;
create or replace function public.request_customer_exit(p_session_id uuid)
returns uuid language sql security invoker set search_path = pg_catalog, public, private
as $$ select private.request_customer_exit(p_session_id) $$;
revoke all on function public.request_customer_exit(uuid) from public, anon;
grant execute on function public.request_customer_exit(uuid) to authenticated;

create or replace function private.audit_customer_session_closed()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if old.status = 'open' and new.status = 'closed' and new.customer_id is not null then
    insert into public.customer_session_events(session_id, customer_id, auth_user_id, event_type)
    values (new.id, new.customer_id, new.owner_user_id, 'session_closed');
  end if;
  return new;
end; $$;
revoke all on function private.audit_customer_session_closed() from public, anon, authenticated;
drop trigger if exists audit_customer_session_closed on public.table_sessions;
create trigger audit_customer_session_closed after update of status on public.table_sessions
for each row execute function private.audit_customer_session_closed();
