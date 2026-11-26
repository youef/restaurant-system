-- QR re-scan, atomic table reservation, expiring unused reservations, and customer-owned sessions.
create extension if not exists pg_cron;

alter table public.table_sessions
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null,
  add column if not exists customer_id uuid references public.customer_profiles(id) on delete set null,
  add column if not exists reservation_expires_at timestamptz;

drop index if exists public.one_open_table_session_per_guest;
create index if not exists table_sessions_owner_open_idx
  on public.table_sessions(owner_user_id) where status = 'open' and owner_user_id is not null;
create unique index if not exists one_open_table_session_per_customer
  on public.table_sessions(customer_id) where status = 'open' and customer_id is not null;

create or replace function private.release_expired_table_reservations()
returns integer language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_count integer;
begin
  with expired as (
    update public.table_sessions ts
       set status = 'closed', closed_at = now(), reservation_expires_at = null
     where ts.status = 'open' and ts.reservation_expires_at is not null
       and ts.reservation_expires_at <= now()
       and not exists (select 1 from public.orders o where o.session_id = ts.id)
    returning ts.table_id
  )
  update public.restaurant_tables t set status = 'available'
   where t.id in (select table_id from expired);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function private.release_expired_table_reservations() from public, anon, authenticated;

create or replace function private.join_table_session(p_qr uuid)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_table public.restaurant_tables%rowtype;
  v_session public.table_sessions%rowtype;
  v_customer_id uuid;
  v_session_id uuid;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل جلسة العميل أولاً' using errcode = '28000'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is not true
     or private.current_app_role() is distinct from 'guest' then
    raise exception 'هذه العملية متاحة لجلسة العميل فقط' using errcode = '42501';
  end if;
  select cp.id into v_customer_id from public.customer_profiles cp where cp.auth_user_id = auth.uid();
  if v_customer_id is null then raise exception 'أكمل التحقق من رقم الجوال وسنة الميلاد أولاً' using errcode = '42501'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_customer_id::text, 1));
  select * into v_table from public.restaurant_tables where qr_token = p_qr for update;
  if not found then raise exception 'رمز الطاولة غير صحيح' using errcode = 'P0002'; end if;
  if v_table.status = 'out_of_service' then raise exception 'هذه الطاولة خارج الخدمة حالياً' using errcode = 'P0001'; end if;

  select * into v_session from public.table_sessions
   where customer_id = v_customer_id and status = 'open' for update;
  if found then
    if v_session.reservation_expires_at is not null
       and v_session.reservation_expires_at <= now()
       and not exists (select 1 from public.orders o where o.session_id = v_session.id) then
      update public.table_sessions set status = 'closed', closed_at = now(), reservation_expires_at = null where id = v_session.id;
      update public.restaurant_tables set status = 'available' where id = v_session.table_id;
    elsif v_session.table_id = v_table.id then
      insert into public.session_members(session_id, user_id) values (v_session.id, auth.uid()) on conflict do nothing;
      update public.table_sessions set owner_user_id = auth.uid() where id = v_session.id and owner_user_id is null;
      return v_session.id;
    else
      raise exception 'لديك زيارة مفتوحة على طاولة أخرى. أنهِ الزيارة الحالية أولاً.' using errcode = 'P0001';
    end if;
  end if;

  select * into v_session from public.table_sessions
   where table_id = v_table.id and status = 'open' for update;
  if found then
    if v_session.reservation_expires_at is not null
       and v_session.reservation_expires_at <= now()
       and not exists (select 1 from public.orders o where o.session_id = v_session.id) then
      update public.table_sessions set status = 'closed', closed_at = now(), reservation_expires_at = null where id = v_session.id;
      update public.restaurant_tables set status = 'available' where id = v_table.id;
      v_table.status := 'available';
    elsif exists (select 1 from public.session_members sm where sm.session_id = v_session.id and sm.user_id = auth.uid())
       or exists (select 1 from public.orders o where o.session_id = v_session.id and o.customer_id = v_customer_id) then
      update public.table_sessions
         set customer_id = v_customer_id, owner_user_id = auth.uid(),
             reservation_expires_at = case
               when exists (select 1 from public.orders o where o.session_id = v_session.id) then null
               else coalesce(reservation_expires_at, now() + interval '10 minutes') end
       where id = v_session.id;
      insert into public.session_members(session_id, user_id) values (v_session.id, auth.uid()) on conflict do nothing;
      return v_session.id;
    else
      raise exception 'الطاولة مشغولة حالياً. اختر طاولة أخرى أو انتظر حتى يتم إخلاؤها.' using errcode = 'P0001';
    end if;
  end if;

  if v_table.status <> 'available' then
    raise exception 'الطاولة مشغولة حالياً. اختر طاولة أخرى أو انتظر حتى يتم إخلاؤها.' using errcode = 'P0001';
  end if;
  insert into public.table_sessions(table_id, owner_user_id, customer_id, reservation_expires_at)
  values (v_table.id, auth.uid(), v_customer_id, now() + interval '10 minutes') returning id into v_session_id;
  update public.restaurant_tables set status = 'occupied' where id = v_table.id;
  insert into public.session_members(session_id, user_id) values (v_session_id, auth.uid()) on conflict do nothing;
  return v_session_id;
end;
$$;
revoke all on function private.join_table_session(uuid) from public, anon;
grant execute on function private.join_table_session(uuid) to authenticated;

create or replace function private.touch_table_reservation(p_session_id uuid)
returns boolean language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_customer_id uuid;
  v_updated integer;
begin
  if private.current_app_role() is distinct from 'guest' then raise exception 'غير مصرح' using errcode = '42501'; end if;
  select cp.id into v_customer_id from public.customer_profiles cp where cp.auth_user_id = auth.uid();
  update public.table_sessions ts
     set reservation_expires_at = now() + interval '10 minutes'
   where ts.id = p_session_id and ts.status = 'open' and ts.customer_id = v_customer_id
     and ts.reservation_expires_at is not null
     and not exists (select 1 from public.orders o where o.session_id = ts.id);
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;
revoke all on function private.touch_table_reservation(uuid) from public, anon;
grant execute on function private.touch_table_reservation(uuid) to authenticated;

create or replace function public.touch_table_reservation(p_session_id uuid)
returns boolean language sql security invoker
set search_path = pg_catalog, public
as $$ select private.touch_table_reservation(p_session_id) $$;
revoke all on function public.touch_table_reservation(uuid) from public, anon;
grant execute on function public.touch_table_reservation(uuid) to authenticated;

create or replace function private.place_order(p_session_id uuid, p_items jsonb, p_notes text default null)
returns table(order_id uuid, order_no bigint, subtotal numeric, vat_amount numeric, total numeric)
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_table_id uuid;
  v_subtotal numeric(10,2);
  v_vat_rate numeric(5,4);
  v_vat_amount numeric(10,2);
  v_total numeric(10,2);
  v_order_id uuid;
  v_order_no bigint;
  v_count integer;
begin
  if private.current_app_role() is distinct from 'guest' or not private.is_session_member(p_session_id) then
    raise exception 'لا تملك صلاحية الطلب من هذه الجلسة' using errcode = '42501';
  end if;
  select table_id into v_table_id from public.table_sessions where id = p_session_id and status = 'open' for update;
  if not found then raise exception 'الجلسة مغلقة أو غير موجودة' using errcode = 'P0002'; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'قائمة الأصناف غير صالحة'; end if;
  select count(*) into v_count from jsonb_array_elements(p_items);
  if v_count < 1 or v_count > 30 then raise exception 'يجب أن يحتوي الطلب من صنف واحد إلى 30 صنفاً'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as x(product_id uuid, quantity integer, notes text)
    left join public.products p on p.id = x.product_id
    where x.product_id is null or x.quantity is null or x.quantity < 1 or x.quantity > 20
       or p.id is null or p.is_active is false or p.is_available is false
  ) then raise exception 'يوجد صنف غير متاح أو كمية غير صالحة'; end if;
  select coalesce(sum(p.price * x.quantity), 0)::numeric(10,2) into v_subtotal
  from jsonb_to_recordset(p_items) as x(product_id uuid, quantity integer, notes text)
  join public.products p on p.id = x.product_id;
  select vat_rate into v_vat_rate from public.settings where id = 1;
  if v_vat_rate is null then raise exception 'لم يتم إعداد نسبة الضريبة'; end if;
  v_total := round(v_subtotal * (1 + v_vat_rate), 2);
  v_vat_amount := v_total - v_subtotal;
  update public.table_sessions set reservation_expires_at = null where id = p_session_id;
  insert into public.orders(session_id, table_id, subtotal, vat_amount, total, notes, placed_by)
  values (p_session_id, v_table_id, v_subtotal, v_vat_amount, v_total, nullif(left(trim(coalesce(p_notes,'')),500),''), auth.uid())
  returning id, orders.order_no into v_order_id, v_order_no;
  insert into public.order_items(order_id, product_id, name_ar, unit_price, quantity, line_total, station, notes)
  select v_order_id, p.id, p.name_ar, p.price, x.quantity, (p.price * x.quantity)::numeric(10,2), p.station,
         nullif(left(trim(coalesce(x.notes,'')),250),'')
  from jsonb_to_recordset(p_items) as x(product_id uuid, quantity integer, notes text)
  join public.products p on p.id = x.product_id;
  return query select v_order_id, v_order_no, v_subtotal, v_vat_amount, v_total;
end;
$$;

create or replace function private.place_order(
  p_session_id uuid, p_items jsonb, p_notes text, p_payment_method public.payment_method
)
returns table(order_id uuid, order_no bigint, subtotal numeric, vat_amount numeric, total numeric)
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_order record;
begin
  if p_payment_method is null then raise exception 'يرجى تحديد طريقة الدفع'; end if;
  select * into v_order from private.place_order(p_session_id, p_items, p_notes);
  update public.orders set payment_method = p_payment_method where id = v_order.order_id;
  return query select v_order.order_id, v_order.order_no, v_order.subtotal, v_order.vat_amount, v_order.total;
end;
$$;

select cron.unschedule(jobid) from cron.job where jobname = 'release-expired-table-reservations';
select cron.schedule('release-expired-table-reservations', '* * * * *', 'select private.release_expired_table_reservations();');
