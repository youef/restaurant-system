-- Initial schema for the table-ordering platform.
-- Monetary values are computed only in PostgreSQL RPC functions.
create extension if not exists pgcrypto;

create type public.app_role as enum ('guest','cashier','kitchen','waiter','admin');
create type public.table_status as enum ('available','occupied','out_of_service');
create type public.session_status as enum ('open','closed');
create type public.order_status as enum ('pending','approved','preparing','ready','served','paid','rejected');
create type public.bill_status as enum ('requested','acknowledged','closed');
create type public.payment_method as enum ('cash','card');
create type public.kitchen_station as enum ('kitchen','grill','bar','dessert');

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role public.app_role not null default 'guest',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.settings (
  id integer primary key default 1 check (id = 1),
  restaurant_name_ar text not null,
  restaurant_name_en text,
  vat_rate numeric(5,4) not null default 0.1500 check (vat_rate >= 0 and vat_rate <= 1),
  currency text not null default 'SAR' check (currency = 'SAR'),
  timezone text not null default 'Asia/Riyadh',
  logo_path text,
  phone text,
  address text,
  opening_hours jsonb not null default '{}'::jsonb,
  default_language text not null default 'ar' check (default_language in ('ar','en')),
  updated_at timestamptz not null default now()
);

insert into public.settings (id, restaurant_name_ar, restaurant_name_en, vat_rate)
values (1, 'مطعمك', 'Your restaurant', 0.1500)
on conflict (id) do nothing;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null,
  name_en text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id),
  name_ar text not null,
  name_en text,
  description_ar text,
  description_en text,
  price numeric(10,2) not null check (price >= 0),
  image_path text,
  station public.kitchen_station not null default 'kitchen',
  is_available boolean not null default true,
  is_active boolean not null default true,
  is_featured boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  number integer not null unique check (number > 0),
  seats integer not null default 4 check (seats > 0 and seats <= 30),
  qr_token uuid not null unique default gen_random_uuid(),
  status public.table_status not null default 'available',
  updated_at timestamptz not null default now()
);

create table public.table_sessions (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.restaurant_tables(id),
  status public.session_status not null default 'open',
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  check ((status = 'open' and closed_at is null) or (status = 'closed' and closed_at is not null))
);
create unique index one_open_session_per_table
  on public.table_sessions(table_id) where status = 'open';

create table public.session_members (
  session_id uuid not null references public.table_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_no bigint generated always as identity (start with 1001),
  session_id uuid not null references public.table_sessions(id),
  table_id uuid not null references public.restaurant_tables(id),
  status public.order_status not null default 'pending',
  subtotal numeric(10,2) not null check (subtotal >= 0),
  vat_amount numeric(10,2) not null check (vat_amount >= 0),
  total numeric(10,2) not null check (total >= subtotal),
  notes text,
  placed_by uuid not null references auth.users(id),
  placed_at timestamptz not null default now(),
  approved_at timestamptz,
  prepared_at timestamptz,
  ready_at timestamptz,
  served_at timestamptz,
  paid_at timestamptz,
  rejected_at timestamptz,
  rejected_reason text,
  check ((status = 'rejected' and rejected_reason is not null and rejected_at is not null)
      or status <> 'rejected')
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  name_ar text not null,
  unit_price numeric(10,2) not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0 and quantity <= 20),
  line_total numeric(10,2) not null check (line_total >= 0),
  station public.kitchen_station not null,
  notes text,
  created_at timestamptz not null default now()
);

create table public.bill_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.table_sessions(id),
  status public.bill_status not null default 'requested',
  requested_at timestamptz not null default now(),
  acknowledged_by uuid references auth.users(id),
  acknowledged_at timestamptz,
  closed_at timestamptz
);
create unique index one_open_bill_request_per_session
  on public.bill_requests(session_id) where status in ('requested','acknowledged');

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.table_sessions(id),
  method public.payment_method not null,
  amount numeric(10,2) not null check (amount >= 0),
  received_by uuid not null references auth.users(id),
  received_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  action text not null,
  entity text not null,
  entity_id text,
  meta jsonb,
  created_at timestamptz not null default now()
);

create index orders_session_id_idx on public.orders(session_id);
create index orders_status_idx on public.orders(status);
create index orders_table_placed_idx on public.orders(table_id, placed_at desc);
create index order_items_order_id_idx on public.order_items(order_id);
create index bill_requests_session_status_idx on public.bill_requests(session_id, status);
create index products_category_sort_idx on public.products(category_id, sort_order) where is_active;
create index audit_logs_created_at_idx on public.audit_logs(created_at desc);

create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger restaurant_tables_touch_updated_at
before update on public.restaurant_tables
for each row execute function private.touch_updated_at();
create trigger products_touch_updated_at
before update on public.products
for each row execute function private.touch_updated_at();
create trigger settings_touch_updated_at
before update on public.settings
for each row execute function private.touch_updated_at();

create or replace function private.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  insert into public.profiles(id, full_name, role)
  values (new.id, nullif(new.raw_user_meta_data ->> 'full_name',''), 'guest')
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function private.handle_new_auth_user() from public, anon, authenticated;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_auth_user();

create or replace function private.current_app_role()
returns public.app_role
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid() and p.is_active = true
  limit 1
$$;

create or replace function private.is_session_member(p_session_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.session_members sm
    join public.table_sessions ts on ts.id = sm.session_id
    where sm.session_id = p_session_id
      and sm.user_id = auth.uid()
      and ts.status = 'open'
  )
$$;

revoke all on function private.current_app_role() from public, anon;
revoke all on function private.is_session_member(uuid) from public, anon;
grant execute on function private.current_app_role() to authenticated;
grant execute on function private.is_session_member(uuid) to authenticated;

create or replace function private.log_status_change()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_old text;
  v_new text;
  v_id text;
begin
  v_old := to_jsonb(old) ->> 'status';
  v_new := to_jsonb(new) ->> 'status';
  if v_old is distinct from v_new then
    v_id := coalesce(to_jsonb(new) ->> 'id', to_jsonb(new) ->> 'number');
    insert into public.audit_logs(actor_id, action, entity, entity_id, meta)
    values (auth.uid(), 'status_changed', tg_table_name, v_id,
      jsonb_build_object('from', v_old, 'to', v_new));
  end if;
  return new;
end;
$$;
revoke all on function private.log_status_change() from public, anon, authenticated;
create trigger orders_status_audit after update of status on public.orders
for each row execute function private.log_status_change();
create trigger tables_status_audit after update of status on public.restaurant_tables
for each row execute function private.log_status_change();
create trigger sessions_status_audit after update of status on public.table_sessions
for each row execute function private.log_status_change();
create trigger bills_status_audit after update of status on public.bill_requests
for each row execute function private.log_status_change();

-- RPC: safe QR lookup reveals only table number and availability.
create or replace function public.resolve_table(p_qr uuid)
returns table(table_number integer, status public.table_status)
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select t.number, t.status
  from public.restaurant_tables t
  where t.qr_token = p_qr
  limit 1
$$;

create or replace function public.join_table_session(p_qr uuid)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_table public.restaurant_tables%rowtype;
  v_session_id uuid;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل جلسة العميل أولاً' using errcode = '28000'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is not true
     or private.current_app_role() is distinct from 'guest' then
    raise exception 'هذه العملية متاحة لجلسة عميل مجهولة فقط' using errcode = '42501';
  end if;

  select * into v_table
  from public.restaurant_tables
  where qr_token = p_qr
  for update;

  if not found then raise exception 'رمز الطاولة غير صحيح' using errcode = 'P0002'; end if;
  if v_table.status = 'out_of_service' then raise exception 'هذه الطاولة غير متاحة حالياً' using errcode = 'P0001'; end if;

  select id into v_session_id
  from public.table_sessions
  where table_id = v_table.id and status = 'open'
  limit 1;

  if v_session_id is null then
    insert into public.table_sessions(table_id) values (v_table.id) returning id into v_session_id;
    update public.restaurant_tables set status = 'occupied' where id = v_table.id;
  end if;

  insert into public.session_members(session_id, user_id)
  values (v_session_id, auth.uid())
  on conflict (session_id, user_id) do nothing;

  return v_session_id;
end;
$$;

create or replace function public.place_order(
  p_session_id uuid,
  p_items jsonb,
  p_notes text default null
)
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
  select table_id into v_table_id from public.table_sessions
  where id = p_session_id and status = 'open' for update;
  if not found then raise exception 'الجلسة مغلقة أو غير موجودة' using errcode = 'P0002'; end if;

  if jsonb_typeof(p_items) <> 'array' then raise exception 'قائمة الأصناف غير صالحة'; end if;
  select count(*) into v_count from jsonb_array_elements(p_items);
  if v_count < 1 or v_count > 30 then raise exception 'يجب أن يحتوي الطلب من صنف واحد إلى 30 صنفاً'; end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity integer, notes text)
    left join public.products p on p.id = x.product_id
    where x.product_id is null or x.quantity is null or x.quantity < 1 or x.quantity > 20
       or p.id is null or p.is_active is false or p.is_available is false
  ) then
    raise exception 'يوجد صنف غير متاح أو كمية غير صالحة';
  end if;

  select coalesce(sum(p.price * x.quantity), 0)::numeric(10,2)
  into v_subtotal
  from jsonb_to_recordset(p_items) as x(product_id uuid, quantity integer, notes text)
  join public.products p on p.id = x.product_id;

  select vat_rate into v_vat_rate from public.settings where id = 1;
  if v_vat_rate is null then raise exception 'لم يتم إعداد نسبة الضريبة'; end if;
  v_total := round(v_subtotal * (1 + v_vat_rate), 2);
  v_vat_amount := v_total - v_subtotal;

  insert into public.orders(session_id, table_id, subtotal, vat_amount, total, notes, placed_by)
  values (p_session_id, v_table_id, v_subtotal, v_vat_amount, v_total, nullif(left(trim(coalesce(p_notes,'')),500),''), auth.uid())
  returning id, orders.order_no into v_order_id, v_order_no;

  insert into public.order_items(order_id, product_id, name_ar, unit_price, quantity, line_total, station, notes)
  select v_order_id, p.id, p.name_ar, p.price, x.quantity,
         (p.price * x.quantity)::numeric(10,2), p.station,
         nullif(left(trim(coalesce(x.notes,'')),250),'')
  from jsonb_to_recordset(p_items) as x(product_id uuid, quantity integer, notes text)
  join public.products p on p.id = x.product_id;

  return query select v_order_id, v_order_no, v_subtotal, v_vat_amount, v_total;
end;
$$;

create or replace function public.advance_order(
  p_order_id uuid,
  p_to_status public.order_status,
  p_reason text default null
)
returns public.order_status
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.orders%rowtype;
  v_role public.app_role;
begin
  v_role := private.current_app_role();
  if v_role is null or v_role = 'guest' then raise exception 'غير مصرح' using errcode = '42501'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'الطلب غير موجود' using errcode = 'P0002'; end if;

  if not (
    (v_order.status = 'pending' and p_to_status in ('approved','rejected') and v_role in ('cashier','admin')) or
    (v_order.status = 'approved' and p_to_status = 'preparing' and v_role in ('kitchen','admin')) or
    (v_order.status = 'preparing' and p_to_status = 'ready' and v_role in ('kitchen','admin')) or
    (v_order.status = 'ready' and p_to_status = 'served' and v_role in ('waiter','admin'))
  ) then
    raise exception 'انتقال حالة الطلب غير مسموح: % إلى %', v_order.status, p_to_status using errcode = '42501';
  end if;
  if p_to_status = 'rejected' and nullif(trim(coalesce(p_reason,'')),'') is null then
    raise exception 'سبب الرفض مطلوب';
  end if;

  update public.orders set
    status = p_to_status,
    approved_at = case when p_to_status = 'approved' then now() else approved_at end,
    prepared_at = case when p_to_status = 'preparing' then now() else prepared_at end,
    ready_at = case when p_to_status = 'ready' then now() else ready_at end,
    served_at = case when p_to_status = 'served' then now() else served_at end,
    rejected_at = case when p_to_status = 'rejected' then now() else rejected_at end,
    rejected_reason = case when p_to_status = 'rejected' then left(trim(p_reason),500) else rejected_reason end
  where id = p_order_id;
  return p_to_status;
end;
$$;

create or replace function public.request_bill(p_session_id uuid)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_request_id uuid;
begin
  if private.current_app_role() is distinct from 'guest' or not private.is_session_member(p_session_id) then
    raise exception 'لا تملك صلاحية طلب الحساب' using errcode = '42501';
  end if;
  perform 1 from public.table_sessions where id = p_session_id and status = 'open' for update;
  if not found then raise exception 'الجلسة مغلقة'; end if;
  select id into v_request_id from public.bill_requests
  where session_id = p_session_id and status in ('requested','acknowledged') limit 1;
  if v_request_id is null then
    insert into public.bill_requests(session_id) values (p_session_id) returning id into v_request_id;
  end if;
  return v_request_id;
end;
$$;

create or replace function public.acknowledge_bill(p_request_id uuid)
returns public.bill_status
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_status public.bill_status;
begin
  if coalesce(private.current_app_role()::text, '') not in ('waiter','admin') then raise exception 'غير مصرح' using errcode = '42501'; end if;
  update public.bill_requests
  set status = 'acknowledged', acknowledged_by = auth.uid(), acknowledged_at = now()
  where id = p_request_id and status = 'requested'
  returning status into v_status;
  if v_status is null then raise exception 'طلب الحساب غير موجود أو تمت معالجته'; end if;
  return v_status;
end;
$$;

create or replace function public.close_session(
  p_session_id uuid,
  p_method public.payment_method
)
returns numeric(10,2)
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_table_id uuid;
  v_amount numeric(10,2);
begin
  if coalesce(private.current_app_role()::text, '') not in ('waiter','admin') then raise exception 'غير مصرح' using errcode = '42501'; end if;
  select table_id into v_table_id from public.table_sessions
  where id = p_session_id and status = 'open' for update;
  if not found then raise exception 'الجلسة مغلقة أو غير موجودة'; end if;

  if exists (
    select 1 from public.orders
    where session_id = p_session_id and status not in ('served','rejected')
  ) then
    raise exception 'لا يمكن إغلاق الحساب قبل تقديم أو رفض جميع الطلبات';
  end if;

  select coalesce(sum(total) filter (where status <> 'rejected'),0)::numeric(10,2)
  into v_amount
  from public.orders where session_id = p_session_id;

  insert into public.payments(session_id, method, amount, received_by)
  values (p_session_id, p_method, v_amount, auth.uid());

  update public.orders set status = 'paid', paid_at = now()
  where session_id = p_session_id and status = 'served';
  update public.bill_requests set status = 'closed', closed_at = now()
  where session_id = p_session_id and status in ('requested','acknowledged');
  update public.table_sessions set status = 'closed', closed_at = now()
  where id = p_session_id;
  update public.restaurant_tables set status = 'available'
  where id = v_table_id;

  return v_amount;
end;
$$;

create or replace function public.set_table_status(
  p_table_id uuid,
  p_status public.table_status
)
returns public.table_status
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_current public.table_status;
begin
  if private.current_app_role() is distinct from 'admin' then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if p_status = 'occupied' then raise exception 'حالة مشغولة يضبطها النظام تلقائياً'; end if;
  select status into v_current from public.restaurant_tables where id = p_table_id for update;
  if not found then raise exception 'الطاولة غير موجودة'; end if;
  if exists (select 1 from public.table_sessions where table_id = p_table_id and status = 'open') then
    raise exception 'لا يمكن تغيير حالة طاولة لديها جلسة مفتوحة';
  end if;
  update public.restaurant_tables set status = p_status where id = p_table_id;
  return p_status;
end;
$$;

create or replace function public.add_tables(p_count integer, p_seats integer default 4)
returns setof public.restaurant_tables
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_start integer;
begin
  if private.current_app_role() is distinct from 'admin' then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if p_count is null or p_count < 1 or p_count > 100 then raise exception 'عدد الطاولات يجب أن يكون بين 1 و100'; end if;
  if p_seats is null or p_seats < 1 or p_seats > 30 then raise exception 'عدد المقاعد يجب أن يكون بين 1 و30'; end if;
  perform pg_advisory_xact_lock(20261126, 1);
  select coalesce(max(number),0) + 1 into v_start from public.restaurant_tables;
  return query
    insert into public.restaurant_tables(number, seats)
    select v_start + g, p_seats from generate_series(0, p_count - 1) as g
    returning *;
end;
$$;

create or replace function public.delete_table(p_table_id uuid)
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if private.current_app_role() is distinct from 'admin' then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if exists (select 1 from public.table_sessions where table_id = p_table_id) then
    raise exception 'لا يمكن حذف طاولة لها سجل جلسات؛ اجعلها خارج الخدمة';
  end if;
  delete from public.restaurant_tables where id = p_table_id;
  if not found then raise exception 'الطاولة غير موجودة'; end if;
end;
$$;

-- Restrict public RPC execution explicitly. SECURITY DEFINER is never left executable by PUBLIC.
revoke all on function public.resolve_table(uuid) from public;
revoke all on function public.join_table_session(uuid) from public;
revoke all on function public.place_order(uuid,jsonb,text) from public;
revoke all on function public.advance_order(uuid,public.order_status,text) from public;
revoke all on function public.request_bill(uuid) from public;
revoke all on function public.acknowledge_bill(uuid) from public;
revoke all on function public.close_session(uuid,public.payment_method) from public;
revoke all on function public.set_table_status(uuid,public.table_status) from public;
revoke all on function public.add_tables(integer,integer) from public;
revoke all on function public.delete_table(uuid) from public;
grant execute on function public.resolve_table(uuid) to anon, authenticated;
grant execute on function public.join_table_session(uuid) to authenticated;
grant execute on function public.place_order(uuid,jsonb,text) to authenticated;
grant execute on function public.advance_order(uuid,public.order_status,text) to authenticated;
grant execute on function public.request_bill(uuid) to authenticated;
grant execute on function public.acknowledge_bill(uuid) to authenticated;
grant execute on function public.close_session(uuid,public.payment_method) to authenticated;
grant execute on function public.set_table_status(uuid,public.table_status) to authenticated;
grant execute on function public.add_tables(integer,integer) to authenticated;
grant execute on function public.delete_table(uuid) to authenticated;

-- RLS on every public application table.
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.restaurant_tables enable row level security;
alter table public.table_sessions enable row level security;
alter table public.session_members enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.bill_requests enable row level security;
alter table public.payments enable row level security;
alter table public.audit_logs enable row level security;

grant select on public.settings, public.categories, public.products to anon, authenticated;
grant select on public.profiles, public.restaurant_tables, public.table_sessions, public.session_members,
  public.orders, public.order_items, public.bill_requests, public.payments, public.audit_logs to authenticated;
grant insert, update, delete on public.categories, public.products to authenticated;
grant update on public.profiles, public.settings to authenticated;

create policy settings_read on public.settings for select to anon, authenticated using (true);
create policy settings_admin_update on public.settings for update to authenticated
using ((select private.current_app_role()) = 'admin')
with check ((select private.current_app_role()) = 'admin');

create policy categories_anon_read on public.categories for select to anon
using (is_active);
create policy categories_auth_read on public.categories for select to authenticated
using (is_active or (select private.current_app_role()) in ('cashier','kitchen','waiter','admin'));
create policy categories_admin_insert on public.categories for insert to authenticated
with check ((select private.current_app_role()) = 'admin');
create policy categories_admin_update on public.categories for update to authenticated
using ((select private.current_app_role()) = 'admin')
with check ((select private.current_app_role()) = 'admin');
create policy categories_admin_delete on public.categories for delete to authenticated
using ((select private.current_app_role()) = 'admin');

create policy products_anon_read on public.products for select to anon
using (is_active and exists (
  select 1 from public.categories c where c.id = category_id and c.is_active
));
create policy products_auth_read on public.products for select to authenticated
using ((is_active and exists (
  select 1 from public.categories c where c.id = category_id and c.is_active
)) or (select private.current_app_role()) in ('cashier','kitchen','waiter','admin'));
create policy products_admin_insert on public.products for insert to authenticated
with check ((select private.current_app_role()) = 'admin');
create policy products_admin_update on public.products for update to authenticated
using ((select private.current_app_role()) = 'admin')
with check ((select private.current_app_role()) = 'admin');
create policy products_admin_delete on public.products for delete to authenticated
using ((select private.current_app_role()) = 'admin');

create policy profiles_self_or_admin_read on public.profiles for select to authenticated
using (id = auth.uid() or (select private.current_app_role()) = 'admin');
create policy profiles_admin_update on public.profiles for update to authenticated
using ((select private.current_app_role()) = 'admin')
with check ((select private.current_app_role()) = 'admin');

create policy tables_staff_read on public.restaurant_tables for select to authenticated
using ((select private.current_app_role()) in ('cashier','kitchen','waiter','admin'));

create policy sessions_member_or_staff_read on public.table_sessions for select to authenticated
using (
  private.is_session_member(id) or
  (select private.current_app_role()) in ('cashier','waiter','admin')
);
create policy session_members_self_or_staff_read on public.session_members for select to authenticated
using (
  user_id = auth.uid() or
  (select private.current_app_role()) in ('cashier','waiter','admin')
);

create policy orders_guest_read on public.orders for select to authenticated
using (
  (select private.current_app_role()) = 'guest' and private.is_session_member(session_id)
);
create policy orders_cashier_admin_read on public.orders for select to authenticated
using ((select private.current_app_role()) in ('cashier','admin'));
create policy orders_kitchen_read on public.orders for select to authenticated
using ((select private.current_app_role()) = 'kitchen' and status in ('approved','preparing','ready'));
create policy orders_waiter_read on public.orders for select to authenticated
using (
  (select private.current_app_role()) = 'waiter'
  and (
    status in ('ready','served') or
    exists (select 1 from public.bill_requests b where b.session_id = orders.session_id and b.status in ('requested','acknowledged'))
  )
);

create policy order_items_visible_with_order on public.order_items for select to authenticated
using (exists (
  select 1 from public.orders o
  where o.id = order_id
    and (
      ((select private.current_app_role()) = 'guest' and private.is_session_member(o.session_id)) or
      ((select private.current_app_role()) in ('cashier','admin')) or
      ((select private.current_app_role()) = 'kitchen' and o.status in ('approved','preparing','ready')) or
      ((select private.current_app_role()) = 'waiter' and (
        o.status in ('ready','served') or exists (
          select 1 from public.bill_requests b where b.session_id = o.session_id and b.status in ('requested','acknowledged')
        )
      ))
    )
));

create policy bills_guest_or_staff_read on public.bill_requests for select to authenticated
using (
  ((select private.current_app_role()) = 'guest' and private.is_session_member(session_id)) or
  ((select private.current_app_role()) in ('cashier','waiter','admin'))
);
create policy payments_guest_or_staff_read on public.payments for select to authenticated
using (
  ((select private.current_app_role()) = 'guest' and private.is_session_member(session_id)) or
  ((select private.current_app_role()) in ('cashier','waiter','admin'))
);
create policy audit_admin_read on public.audit_logs for select to authenticated
using ((select private.current_app_role()) = 'admin');

-- Storage: public read; only admins may mutate product images.
insert into storage.buckets(id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = excluded.public;

create policy product_images_public_read on storage.objects
for select to anon, authenticated
using (bucket_id = 'product-images');
create policy product_images_admin_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'product-images' and (select private.current_app_role()) = 'admin');
create policy product_images_admin_update on storage.objects
for update to authenticated
using (bucket_id = 'product-images' and (select private.current_app_role()) = 'admin')
with check (bucket_id = 'product-images' and (select private.current_app_role()) = 'admin');
create policy product_images_admin_delete on storage.objects
for delete to authenticated
using (bucket_id = 'product-images' and (select private.current_app_role()) = 'admin');

-- Realtime publication membership is idempotent.
do $$
declare v_table text;
begin
  foreach v_table in array array['orders','order_items','bill_requests','restaurant_tables','table_sessions','products'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;
