-- Harden RPC exposure: keep SECURITY DEFINER implementations in the non-exposed private schema.
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter function public.resolve_table(uuid) set schema private;
alter function public.join_table_session(uuid) set schema private;
alter function public.place_order(uuid,jsonb,text) set schema private;
alter function public.advance_order(uuid,public.order_status,text) set schema private;
alter function public.request_bill(uuid) set schema private;
alter function public.acknowledge_bill(uuid) set schema private;
alter function public.close_session(uuid,public.payment_method) set schema private;
alter function public.set_table_status(uuid,public.table_status) set schema private;
alter function public.add_tables(integer,integer) set schema private;
alter function public.delete_table(uuid) set schema private;

revoke all on function private.resolve_table(uuid) from public, anon;
revoke all on function private.join_table_session(uuid) from public, anon;
revoke all on function private.place_order(uuid,jsonb,text) from public, anon;
revoke all on function private.advance_order(uuid,public.order_status,text) from public, anon;
revoke all on function private.request_bill(uuid) from public, anon;
revoke all on function private.acknowledge_bill(uuid) from public, anon;
revoke all on function private.close_session(uuid,public.payment_method) from public, anon;
revoke all on function private.set_table_status(uuid,public.table_status) from public, anon;
revoke all on function private.add_tables(integer,integer) from public, anon;
revoke all on function private.delete_table(uuid) from public, anon;

grant execute on function private.resolve_table(uuid) to authenticated;
grant execute on function private.join_table_session(uuid) to authenticated;
grant execute on function private.place_order(uuid,jsonb,text) to authenticated;
grant execute on function private.advance_order(uuid,public.order_status,text) to authenticated;
grant execute on function private.request_bill(uuid) to authenticated;
grant execute on function private.acknowledge_bill(uuid) to authenticated;
grant execute on function private.close_session(uuid,public.payment_method) to authenticated;
grant execute on function private.set_table_status(uuid,public.table_status) to authenticated;
grant execute on function private.add_tables(integer,integer) to authenticated;
grant execute on function private.delete_table(uuid) to authenticated;

create function public.resolve_table(p_qr uuid)
returns table(table_number integer, status public.table_status)
language sql security invoker
set search_path = pg_catalog, public
as $$ select * from private.resolve_table(p_qr) $$;

create function public.join_table_session(p_qr uuid)
returns uuid language sql security invoker
set search_path = pg_catalog, public
as $$ select private.join_table_session(p_qr) $$;

create function public.place_order(p_session_id uuid,p_items jsonb,p_notes text default null)
returns table(order_id uuid,order_no bigint,subtotal numeric,vat_amount numeric,total numeric)
language sql security invoker
set search_path = pg_catalog, public
as $$ select * from private.place_order(p_session_id,p_items,p_notes) $$;

create function public.advance_order(p_order_id uuid,p_to_status public.order_status,p_reason text default null)
returns public.order_status language sql security invoker
set search_path = pg_catalog, public
as $$ select private.advance_order(p_order_id,p_to_status,p_reason) $$;

create function public.request_bill(p_session_id uuid)
returns uuid language sql security invoker
set search_path = pg_catalog, public
as $$ select private.request_bill(p_session_id) $$;

create function public.acknowledge_bill(p_request_id uuid)
returns public.bill_status language sql security invoker
set search_path = pg_catalog, public
as $$ select private.acknowledge_bill(p_request_id) $$;

create function public.close_session(p_session_id uuid,p_method public.payment_method)
returns numeric(10,2) language sql security invoker
set search_path = pg_catalog, public
as $$ select private.close_session(p_session_id,p_method) $$;

create function public.set_table_status(p_table_id uuid,p_status public.table_status)
returns public.table_status language sql security invoker
set search_path = pg_catalog, public
as $$ select private.set_table_status(p_table_id,p_status) $$;

create function public.add_tables(p_count integer,p_seats integer default 4)
returns setof public.restaurant_tables
language sql security invoker
set search_path = pg_catalog, public
as $$ select * from private.add_tables(p_count,p_seats) $$;

create function public.delete_table(p_table_id uuid)
returns void language sql security invoker
set search_path = pg_catalog, public
as $$ select private.delete_table(p_table_id) $$;

-- Remove Supabase's default direct anon grants; anonymous-authenticated customers use JWT role authenticated.
revoke all on function public.resolve_table(uuid) from public, anon;
revoke all on function public.join_table_session(uuid) from public, anon;
revoke all on function public.place_order(uuid,jsonb,text) from public, anon;
revoke all on function public.advance_order(uuid,public.order_status,text) from public, anon;
revoke all on function public.request_bill(uuid) from public, anon;
revoke all on function public.acknowledge_bill(uuid) from public, anon;
revoke all on function public.close_session(uuid,public.payment_method) from public, anon;
revoke all on function public.set_table_status(uuid,public.table_status) from public, anon;
revoke all on function public.add_tables(integer,integer) from public, anon;
revoke all on function public.delete_table(uuid) from public, anon;

grant execute on function public.resolve_table(uuid) to authenticated;
grant execute on function public.join_table_session(uuid) to authenticated;
grant execute on function public.place_order(uuid,jsonb,text) to authenticated;
grant execute on function public.advance_order(uuid,public.order_status,text) to authenticated;
grant execute on function public.request_bill(uuid) to authenticated;
grant execute on function public.acknowledge_bill(uuid) to authenticated;
grant execute on function public.close_session(uuid,public.payment_method) to authenticated;
grant execute on function public.set_table_status(uuid,public.table_status) to authenticated;
grant execute on function public.add_tables(integer,integer) to authenticated;
grant execute on function public.delete_table(uuid) to authenticated;

-- No application RPC remains SECURITY DEFINER in the exposed public schema.

-- Cover remaining foreign keys.
create index if not exists audit_logs_actor_id_idx on public.audit_logs(actor_id);
create index if not exists bill_requests_acknowledged_by_idx on public.bill_requests(acknowledged_by);
create index if not exists order_items_product_id_idx on public.order_items(product_id);
create index if not exists orders_placed_by_idx on public.orders(placed_by);
create index if not exists payments_received_by_idx on public.payments(received_by);
create index if not exists payments_session_id_idx on public.payments(session_id);
create index if not exists session_members_user_id_idx on public.session_members(user_id);

-- Avoid per-row re-evaluation of auth.uid().
drop policy if exists profiles_self_or_admin_read on public.profiles;
create policy profiles_self_or_admin_read on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select private.current_app_role()) = 'admin');

drop policy if exists session_members_self_or_staff_read on public.session_members;
create policy session_members_self_or_staff_read on public.session_members for select to authenticated
using (
  user_id = (select auth.uid()) or
  (select private.current_app_role()) in ('cashier','waiter','admin')
);

-- Fold the order SELECT rules into a single policy.
drop policy if exists orders_guest_read on public.orders;
drop policy if exists orders_cashier_admin_read on public.orders;
drop policy if exists orders_kitchen_read on public.orders;
drop policy if exists orders_waiter_read on public.orders;
create policy orders_select_by_role on public.orders for select to authenticated
using (
  (
    (select private.current_app_role()) = 'guest'
    and private.is_session_member(session_id)
  ) or
  (select private.current_app_role()) in ('cashier','admin') or
  (
    (select private.current_app_role()) = 'kitchen'
    and status in ('approved','preparing','ready')
  ) or
  (
    (select private.current_app_role()) = 'waiter'
    and (
      status in ('ready','served') or
      exists (
        select 1 from public.bill_requests b
        where b.session_id = orders.session_id
          and b.status in ('requested','acknowledged')
      )
    )
  )
);
