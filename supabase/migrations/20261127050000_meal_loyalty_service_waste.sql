-- Meal-aware menus, loyalty ledger, service requests, coupons and waste tracking.
alter table public.products add column if not exists meal_period text not null default 'all';
alter table public.products drop constraint if exists products_meal_period_check;
alter table public.products add constraint products_meal_period_check check (meal_period in ('all','breakfast','lunch','dinner'));
alter table public.settings add column if not exists meal_period_hours jsonb not null default '{"breakfast":{"start":"05:00","end":"11:00"},"lunch":{"start":"11:00","end":"17:00"},"dinner":{"start":"17:00","end":"05:00"}}'::jsonb;
alter table public.settings add column if not exists loyalty_points_per_currency numeric(8,3) not null default 1 check (loyalty_points_per_currency >= 0);
alter table public.customer_profiles add column if not exists birth_month_hijri smallint;
alter table public.customer_profiles add column if not exists birth_day_hijri smallint;
alter table public.customer_profiles drop constraint if exists customer_profiles_birth_hijri_date_check;
alter table public.customer_profiles add constraint customer_profiles_birth_hijri_date_check check ((birth_month_hijri is null and birth_day_hijri is null) or (birth_month_hijri between 1 and 12 and birth_day_hijri between 1 and 30));

create table if not exists public.service_requests (
 id uuid primary key default gen_random_uuid(), session_id uuid not null references public.table_sessions(id) on delete cascade,
 request_type text not null check (request_type in ('water','napkins','cutlery','waiter')),
 note text, status text not null default 'requested' check (status in ('requested','acknowledged','completed','cancelled')),
 requested_at timestamptz not null default now(), acknowledged_at timestamptz, completed_at timestamptz,
 acknowledged_by uuid references public.profiles(id)
);
create index if not exists service_requests_open_idx on public.service_requests(status,requested_at desc);
create index if not exists service_requests_session_idx on public.service_requests(session_id,requested_at desc);
alter table public.service_requests enable row level security;
revoke all on public.service_requests from anon, authenticated;
grant select, update on public.service_requests to authenticated;
drop policy if exists service_requests_member_or_staff_read on public.service_requests;
create policy service_requests_member_or_staff_read on public.service_requests for select to authenticated using (private.is_session_member(session_id) or (select private.current_app_role()) in ('waiter','cashier','admin'));
drop policy if exists service_requests_staff_update on public.service_requests;
create policy service_requests_staff_update on public.service_requests for update to authenticated using ((select private.current_app_role()) in ('waiter','admin')) with check ((select private.current_app_role()) in ('waiter','admin'));
create or replace function public.create_service_request(p_session_id uuid,p_request_type text,p_note text default null)
returns uuid language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare v_id uuid;
begin
 if auth.uid() is null or not private.is_session_member(p_session_id) then raise exception 'لا تملك صلاحية طلب خدمة لهذه الطاولة' using errcode='42501'; end if;
 if p_request_type not in ('water','napkins','cutlery','waiter') then raise exception 'نوع طلب الخدمة غير صحيح'; end if;
 if not exists(select 1 from public.table_sessions where id=p_session_id and status='open') then raise exception 'جلسة الطاولة مغلقة'; end if;
 insert into public.service_requests(session_id,request_type,note) values(p_session_id,p_request_type,left(nullif(trim(p_note),''),250)) returning id into v_id;
 return v_id;
end $$;
revoke all on function public.create_service_request(uuid,text,text) from public,anon;
grant execute on function public.create_service_request(uuid,text,text) to authenticated;

create table if not exists public.customer_loyalty_ledger (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.customer_profiles(id) on delete cascade,
 order_id uuid not null unique references public.orders(id) on delete cascade, points integer not null check(points>0), created_at timestamptz not null default now()
);
create index if not exists customer_loyalty_customer_idx on public.customer_loyalty_ledger(customer_id,created_at desc);
alter table public.customer_loyalty_ledger enable row level security;
revoke all on public.customer_loyalty_ledger from anon,authenticated;
grant select on public.customer_loyalty_ledger to authenticated;
drop policy if exists loyalty_customer_read_own on public.customer_loyalty_ledger;
create policy loyalty_customer_read_own on public.customer_loyalty_ledger for select to authenticated using (private.is_customer_order_owner(customer_id));
drop policy if exists loyalty_staff_read on public.customer_loyalty_ledger;
create policy loyalty_staff_read on public.customer_loyalty_ledger for select to authenticated using ((select private.current_app_role()) in ('admin','cashier'));
create or replace function private.award_customer_order_points()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_rate numeric;
begin
 if new.status='paid' and old.status is distinct from 'paid' and new.customer_id is not null then
  select loyalty_points_per_currency into v_rate from public.settings where id=1;
  insert into public.customer_loyalty_ledger(customer_id,order_id,points) values(new.customer_id,new.id,greatest(1,floor(new.total*coalesce(v_rate,1))::integer)) on conflict(order_id) do nothing;
 end if;
 return new;
end $$;
revoke all on function private.award_customer_order_points() from public,anon,authenticated;
drop trigger if exists award_customer_order_points on public.orders;
create trigger award_customer_order_points after update of status on public.orders for each row execute function private.award_customer_order_points();

create table if not exists public.loyalty_rewards (
 id uuid primary key default gen_random_uuid(), title text not null, description text, points_cost integer not null check(points_cost>0),
 is_active boolean not null default true, created_at timestamptz not null default now()
);
alter table public.loyalty_rewards enable row level security;
revoke all on public.loyalty_rewards from anon,authenticated;
grant select,insert,update,delete on public.loyalty_rewards to authenticated;
drop policy if exists loyalty_rewards_read_active on public.loyalty_rewards;
create policy loyalty_rewards_read_active on public.loyalty_rewards for select to authenticated using (is_active or (select private.current_app_role())='admin');
drop policy if exists loyalty_rewards_admin_write on public.loyalty_rewards;
create policy loyalty_rewards_admin_write on public.loyalty_rewards for all to authenticated using ((select private.current_app_role())='admin') with check ((select private.current_app_role())='admin');

create table if not exists public.coupons (
 id uuid primary key default gen_random_uuid(), code text not null unique, title text not null, description text,
 discount_percent numeric(5,2) check(discount_percent between 0.01 and 100), discount_amount numeric(10,2) check(discount_amount>0),
 starts_at timestamptz not null default now(), expires_at timestamptz, is_active boolean not null default true, created_at timestamptz not null default now(),
 check ((discount_percent is not null) <> (discount_amount is not null))
);
alter table public.coupons enable row level security;
revoke all on public.coupons from anon,authenticated;
grant select,insert,update,delete on public.coupons to authenticated;
drop policy if exists coupons_read_active on public.coupons;
create policy coupons_read_active on public.coupons for select to authenticated using ((is_active and starts_at<=now() and (expires_at is null or expires_at>=now())) or (select private.current_app_role())='admin');
drop policy if exists coupons_admin_write on public.coupons;
create policy coupons_admin_write on public.coupons for all to authenticated using ((select private.current_app_role())='admin') with check ((select private.current_app_role())='admin');

create table if not exists public.waste_records (
 id uuid primary key default gen_random_uuid(), product_id uuid references public.products(id) on delete set null, product_name text not null,
 quantity numeric(12,3) not null check(quantity>0), unit text not null default 'حبة',
 reason text not null check(reason in ('spoiled','returned','preparation_error','expired','other')), notes text,
 recorded_by uuid not null references public.profiles(id), recorded_at timestamptz not null default now()
);
create index if not exists waste_records_recorded_at_idx on public.waste_records(recorded_at desc);
alter table public.waste_records enable row level security;
revoke all on public.waste_records from anon,authenticated;
grant select,insert on public.waste_records to authenticated;
drop policy if exists waste_admin_select on public.waste_records;
create policy waste_admin_select on public.waste_records for select to authenticated using ((select private.current_app_role())='admin');
drop policy if exists waste_staff_insert on public.waste_records;
create policy waste_staff_insert on public.waste_records for insert to authenticated with check ((select private.current_app_role()) in ('admin','kitchen','waiter'));

create or replace function public.update_customer_birthday(p_month integer,p_day integer)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,private as $$
begin
 if auth.uid() is null or p_month not between 1 and 12 or p_day not between 1 and 30 then raise exception 'تاريخ الميلاد الهجري غير صحيح'; end if;
 update public.customer_profiles set birth_month_hijri=p_month,birth_day_hijri=p_day,updated_at=now() where auth_user_id=auth.uid();
 if not found then raise exception 'ملف العميل غير مرتبط بهذه الجلسة' using errcode='42501'; end if;
 return true;
end $$;
revoke all on function public.update_customer_birthday(integer,integer) from public,anon;
grant execute on function public.update_customer_birthday(integer,integer) to authenticated;
create or replace function public.get_my_loyalty_summary()
returns table(points_balance bigint,lifetime_points bigint,membership_level text)
language sql stable security definer set search_path=pg_catalog,public,private as $$
 select coalesce(sum(l.points),0)::bigint, coalesce(sum(l.points),0)::bigint,
 case when coalesce(sum(l.points),0)>=5000 then 'ذهبي' when coalesce(sum(l.points),0)>=1000 then 'فضي' else 'أساسي' end
 from public.customer_loyalty_ledger l join public.customer_profiles cp on cp.id=l.customer_id where cp.auth_user_id=auth.uid()
$$;
revoke all on function public.get_my_loyalty_summary() from public,anon;
grant execute on function public.get_my_loyalty_summary() to authenticated;


alter table public.settings add column if not exists birthday_discount_percent numeric(5,2) not null default 15 check (birthday_discount_percent between 0.01 and 100);
alter table public.coupons add column if not exists customer_id uuid references public.customer_profiles(id) on delete cascade;
create table if not exists public.birthday_coupon_claims (
 customer_id uuid not null references public.customer_profiles(id) on delete cascade,
 hijri_year integer not null check(hijri_year between 1300 and 1600),
 coupon_id uuid not null unique references public.coupons(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(customer_id,hijri_year)
);
alter table public.birthday_coupon_claims enable row level security;
revoke all on public.birthday_coupon_claims from public,anon,authenticated;
drop policy if exists coupons_read_active on public.coupons;
create policy coupons_read_active on public.coupons for select to authenticated
using (
 (is_active and starts_at<=now() and (expires_at is null or expires_at>=now())
  and (customer_id is null or exists(select 1 from public.customer_profiles cp where cp.id=customer_id and cp.auth_user_id=auth.uid())))
 or (select private.current_app_role())='admin'
);
create or replace function public.claim_birthday_coupon(p_hijri_year integer,p_month integer,p_day integer)
returns table(coupon_code text, already_claimed boolean)
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare v_customer_id uuid; v_birth_month smallint; v_birth_day smallint; v_code text; v_coupon_id uuid; v_existing text;
begin
 if auth.uid() is null then raise exception 'يلزم تسجيل الدخول'; end if;
 select id,birth_month_hijri,birth_day_hijri into v_customer_id,v_birth_month,v_birth_day
 from public.customer_profiles where auth_user_id=auth.uid();
 if v_customer_id is null or v_birth_month is null or v_birth_day is null then
  raise exception 'أكمل تاريخ الميلاد الهجري في ملفك أولاً';
 end if;
 if p_month<>v_birth_month or p_day<>v_birth_day or p_month not between 1 and 12 or p_day not between 1 and 30 or p_hijri_year not between 1300 and 1600 then
  raise exception 'تاريخ الميلاد لا يطابق الملف';
 end if;
 select c.code into v_existing from public.birthday_coupon_claims b join public.coupons c on c.id=b.coupon_id
 where b.customer_id=v_customer_id and b.hijri_year=p_hijri_year;
 if v_existing is not null then return query select v_existing,true; return; end if;
 v_code := 'BDAY-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
 insert into public.coupons(customer_id,code,title,description,discount_percent,starts_at,expires_at,is_active)
 select v_customer_id,v_code,'هدية عيد ميلادك','كوبون عيد ميلاد هجري صالح لمدة 3 أيام',birthday_discount_percent,now(),now()+interval '3 days',true
 from public.settings where id=1 returning id into v_coupon_id;
 insert into public.birthday_coupon_claims(customer_id,hijri_year,coupon_id) values(v_customer_id,p_hijri_year,v_coupon_id);
 return query select v_code,false;
end $$;
revoke all on function public.claim_birthday_coupon(integer,integer,integer) from public,anon;
grant execute on function public.claim_birthday_coupon(integer,integer,integer) to authenticated;
