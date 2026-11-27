-- Coupon checkout, one-time redemption, loyalty reward redemption, and private RPC implementations.
-- Public RPCs are SECURITY INVOKER wrappers; privileged implementation stays in the private schema.
alter table public.orders add column if not exists discount_amount numeric(10,2) not null default 0 check(discount_amount>=0);
alter table public.orders add column if not exists coupon_code text;
alter table public.birthday_coupon_claims set schema private;

create table if not exists private.customer_coupon_redemptions (
 id uuid primary key default gen_random_uuid(), coupon_id uuid not null references public.coupons(id) on delete restrict,
 customer_id uuid not null references public.customer_profiles(id) on delete cascade,
 order_id uuid not null unique references public.orders(id) on delete cascade, redeemed_at timestamptz not null default now(),
 unique(coupon_id,customer_id)
);
revoke all on private.customer_coupon_redemptions from public,anon,authenticated;
create table if not exists private.customer_loyalty_redemptions (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.customer_profiles(id) on delete cascade,
 reward_id uuid not null references public.loyalty_rewards(id) on delete restrict, points_spent integer not null check(points_spent>0),
 redeemed_at timestamptz not null default now()
);
create index if not exists customer_loyalty_redemptions_customer_idx on private.customer_loyalty_redemptions(customer_id,redeemed_at desc);
revoke all on private.customer_loyalty_redemptions from public,anon,authenticated;

create or replace function private.create_service_request(p_session_id uuid,p_request_type text,p_note text default null)
returns uuid language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare v_id uuid;
begin
 if auth.uid() is null or not private.is_session_member(p_session_id) then raise exception 'لا تملك صلاحية طلب خدمة لهذه الطاولة' using errcode='42501'; end if;
 if p_request_type not in ('water','napkins','cutlery','waiter') then raise exception 'نوع طلب الخدمة غير صحيح'; end if;
 if not exists(select 1 from public.table_sessions where id=p_session_id and status='open') then raise exception 'جلسة الطاولة مغلقة'; end if;
 insert into public.service_requests(session_id,request_type,note) values(p_session_id,p_request_type,left(nullif(trim(p_note),''),250)) returning id into v_id;
 return v_id;
end $$;
revoke all on function private.create_service_request(uuid,text,text) from public,anon,authenticated;
grant execute on function private.create_service_request(uuid,text,text) to authenticated;
create or replace function public.create_service_request(p_session_id uuid,p_request_type text,p_note text default null)
returns uuid language sql security invoker set search_path=pg_catalog,public,private as $$ select private.create_service_request(p_session_id,p_request_type,p_note) $$;
revoke all on function public.create_service_request(uuid,text,text) from public,anon;
grant execute on function public.create_service_request(uuid,text,text) to authenticated;

create or replace function private.update_customer_birthday(p_month integer,p_day integer)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,private as $$
begin
 if auth.uid() is null or p_month not between 1 and 12 or p_day not between 1 and 30 then raise exception 'تاريخ الميلاد الهجري غير صحيح'; end if;
 update public.customer_profiles set birth_month_hijri=p_month,birth_day_hijri=p_day,updated_at=now() where auth_user_id=auth.uid();
 if not found then raise exception 'ملف العميل غير مرتبط بهذه الجلسة' using errcode='42501'; end if;
 return true;
end $$;
revoke all on function private.update_customer_birthday(integer,integer) from public,anon,authenticated;
grant execute on function private.update_customer_birthday(integer,integer) to authenticated;
create or replace function public.update_customer_birthday(p_month integer,p_day integer)
returns boolean language sql security invoker set search_path=pg_catalog,public,private as $$ select private.update_customer_birthday(p_month,p_day) $$;
revoke all on function public.update_customer_birthday(integer,integer) from public,anon;
grant execute on function public.update_customer_birthday(integer,integer) to authenticated;

create or replace function private.claim_birthday_coupon(p_hijri_year integer,p_month integer,p_day integer)
returns table(coupon_code text, already_claimed boolean)
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare v_customer_id uuid; v_birth_month smallint; v_birth_day smallint; v_code text; v_coupon_id uuid; v_existing text;
begin
 if auth.uid() is null then raise exception 'يلزم تسجيل الدخول'; end if;
 select id,birth_month_hijri,birth_day_hijri into v_customer_id,v_birth_month,v_birth_day from public.customer_profiles where auth_user_id=auth.uid();
 if v_customer_id is null or v_birth_month is null or v_birth_day is null then raise exception 'أكمل تاريخ الميلاد الهجري في ملفك أولاً'; end if;
 if p_month<>v_birth_month or p_day<>v_birth_day or p_month not between 1 and 12 or p_day not between 1 and 30 or p_hijri_year not between 1300 and 1600 then raise exception 'تاريخ الميلاد لا يطابق الملف'; end if;
 select c.code into v_existing from private.birthday_coupon_claims b join public.coupons c on c.id=b.coupon_id where b.customer_id=v_customer_id and b.hijri_year=p_hijri_year;
 if v_existing is not null then return query select v_existing,true; return; end if;
 v_code := 'BDAY-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
 insert into public.coupons(customer_id,code,title,description,discount_percent,starts_at,expires_at,is_active)
 select v_customer_id,v_code,'هدية عيد ميلادك','كوبون عيد ميلاد هجري صالح لمدة 3 أيام',birthday_discount_percent,now(),now()+interval '3 days',true
 from public.settings where id=1 returning id into v_coupon_id;
 insert into private.birthday_coupon_claims(customer_id,hijri_year,coupon_id) values(v_customer_id,p_hijri_year,v_coupon_id);
 return query select v_code,false;
end $$;
revoke all on function private.claim_birthday_coupon(integer,integer,integer) from public,anon,authenticated;
grant execute on function private.claim_birthday_coupon(integer,integer,integer) to authenticated;
create or replace function public.claim_birthday_coupon(p_hijri_year integer,p_month integer,p_day integer)
returns table(coupon_code text,already_claimed boolean)
language sql security invoker set search_path=pg_catalog,public,private as $$ select * from private.claim_birthday_coupon(p_hijri_year,p_month,p_day) $$;
revoke all on function public.claim_birthday_coupon(integer,integer,integer) from public,anon;
grant execute on function public.claim_birthday_coupon(integer,integer,integer) to authenticated;

create or replace function private.get_my_loyalty_summary()
returns table(points_balance bigint,lifetime_points bigint,membership_level text)
language sql stable security definer set search_path=pg_catalog,public,private as $$
 select greatest(0,coalesce(sum(l.points),0)-coalesce((select sum(r.points_spent) from private.customer_loyalty_redemptions r where r.customer_id=cp.id),0))::bigint,
        coalesce(sum(l.points),0)::bigint,
        case when coalesce(sum(l.points),0)>=5000 then 'ذهبي' when coalesce(sum(l.points),0)>=1000 then 'فضي' else 'أساسي' end
 from public.customer_profiles cp left join public.customer_loyalty_ledger l on l.customer_id=cp.id
 where cp.auth_user_id=auth.uid() group by cp.id
$$;
revoke all on function private.get_my_loyalty_summary() from public,anon,authenticated;
grant execute on function private.get_my_loyalty_summary() to authenticated;
create or replace function public.get_my_loyalty_summary()
returns table(points_balance bigint,lifetime_points bigint,membership_level text)
language sql stable security invoker set search_path=pg_catalog,public,private as $$ select * from private.get_my_loyalty_summary() $$;
revoke all on function public.get_my_loyalty_summary() from public,anon;
grant execute on function public.get_my_loyalty_summary() to authenticated;

create or replace function private.redeem_loyalty_reward(p_reward_id uuid)
returns table(points_balance bigint,reward_title text)
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare v_customer_id uuid; v_cost integer; v_title text; v_earned bigint; v_spent bigint;
begin
 if auth.uid() is null then raise exception 'يلزم تسجيل الدخول'; end if;
 select id into v_customer_id from public.customer_profiles where auth_user_id=auth.uid() for update;
 if v_customer_id is null then raise exception 'ملف العميل غير موجود'; end if;
 select points_cost,title into v_cost,v_title from public.loyalty_rewards where id=p_reward_id and is_active=true;
 if v_cost is null then raise exception 'المكافأة غير متاحة'; end if;
 select coalesce(sum(points),0) into v_earned from public.customer_loyalty_ledger where customer_id=v_customer_id;
 select coalesce(sum(points_spent),0) into v_spent from private.customer_loyalty_redemptions where customer_id=v_customer_id;
 if v_earned-v_spent<v_cost then raise exception 'رصيد النقاط غير كافٍ'; end if;
 insert into private.customer_loyalty_redemptions(customer_id,reward_id,points_spent) values(v_customer_id,p_reward_id,v_cost);
 return query select (v_earned-v_spent-v_cost)::bigint,v_title;
end $$;
revoke all on function private.redeem_loyalty_reward(uuid) from public,anon,authenticated;
grant execute on function private.redeem_loyalty_reward(uuid) to authenticated;
create or replace function public.redeem_loyalty_reward(p_reward_id uuid)
returns table(points_balance bigint,reward_title text)
language sql security invoker set search_path=pg_catalog,public,private as $$ select * from private.redeem_loyalty_reward(p_reward_id) $$;
revoke all on function public.redeem_loyalty_reward(uuid) from public,anon;
grant execute on function public.redeem_loyalty_reward(uuid) to authenticated;

create or replace function private.preview_order_with_coupon(p_session_id uuid,p_items jsonb,p_coupon_code text)
returns table(subtotal numeric,vat_amount numeric,total numeric,discount_amount numeric)
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare v_base record; v_coupon public.coupons%rowtype; v_customer_id uuid; v_discount numeric:=0; v_vat_rate numeric;
begin
 select * into v_base from private.preview_order(p_session_id,p_items);
 select customer_id into v_customer_id from public.table_sessions where id=p_session_id;
 if nullif(trim(p_coupon_code),'') is not null then
  select * into v_coupon from public.coupons where upper(code)=upper(trim(p_coupon_code)) and is_active and starts_at<=now() and (expires_at is null or expires_at>=now()) and (customer_id is null or customer_id=v_customer_id);
  if not found then raise exception 'الكوبون غير صحيح أو منتهي أو غير مخصص لهذا الحساب'; end if;
  if exists(select 1 from private.customer_coupon_redemptions where coupon_id=v_coupon.id and customer_id=v_customer_id) then raise exception 'سبق استخدام هذا الكوبون'; end if;
  v_discount:=least(v_base.subtotal,coalesce(v_base.subtotal*v_coupon.discount_percent/100,v_coupon.discount_amount,0));
 end if;
 select vat_rate into v_vat_rate from public.settings where id=1;
 subtotal:=v_base.subtotal-v_discount; vat_amount:=round(subtotal*v_vat_rate,2); total:=subtotal+vat_amount; discount_amount:=v_discount;
 return next;
end $$;
revoke all on function private.preview_order_with_coupon(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function private.preview_order_with_coupon(uuid,jsonb,text) to authenticated;
create or replace function public.preview_order_with_coupon(p_session_id uuid,p_items jsonb,p_coupon_code text)
returns table(subtotal numeric,vat_amount numeric,total numeric,discount_amount numeric)
language sql security invoker set search_path=pg_catalog,public,private as $$ select * from private.preview_order_with_coupon(p_session_id,p_items,p_coupon_code) $$;
revoke all on function public.preview_order_with_coupon(uuid,jsonb,text) from public,anon;
grant execute on function public.preview_order_with_coupon(uuid,jsonb,text) to authenticated;

create or replace function private.place_order_with_coupon(p_session_id uuid,p_items jsonb,p_notes text,p_payment_method payment_method,p_coupon_code text)
returns table(order_id uuid,order_no bigint,subtotal numeric,vat_amount numeric,total numeric,discount_amount numeric)
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare v_order record; v_coupon public.coupons%rowtype; v_customer_id uuid; v_discount numeric:=0; v_vat_rate numeric; v_new_subtotal numeric; v_new_vat numeric; v_new_total numeric;
begin
 if nullif(trim(p_coupon_code),'') is not null then
  select customer_id into v_customer_id from public.table_sessions where id=p_session_id and status='open';
  select * into v_coupon from public.coupons where upper(code)=upper(trim(p_coupon_code)) and is_active and starts_at<=now() and (expires_at is null or expires_at>=now()) and (customer_id is null or customer_id=v_customer_id);
  if not found then raise exception 'الكوبون غير صحيح أو منتهي أو غير مخصص لهذا الحساب'; end if;
  if exists(select 1 from private.customer_coupon_redemptions where coupon_id=v_coupon.id and customer_id=v_customer_id) then raise exception 'سبق استخدام هذا الكوبون'; end if;
 end if;
 select * into v_order from private.place_order(p_session_id,p_items,p_notes,p_payment_method);
 select customer_id into v_customer_id from public.orders where id=v_order.order_id;
 if nullif(trim(p_coupon_code),'') is not null then
  v_discount:=least(v_order.subtotal,coalesce(v_order.subtotal*v_coupon.discount_percent/100,v_coupon.discount_amount,0));
  select vat_rate into v_vat_rate from public.settings where id=1;
  v_new_subtotal:=v_order.subtotal-v_discount; v_new_vat:=round(v_new_subtotal*v_vat_rate,2); v_new_total:=v_new_subtotal+v_new_vat;
  update public.orders set subtotal=v_new_subtotal,vat_amount=v_new_vat,total=v_new_total,discount_amount=v_discount,coupon_code=upper(trim(p_coupon_code)) where id=v_order.order_id;
  insert into private.customer_coupon_redemptions(coupon_id,customer_id,order_id) values(v_coupon.id,v_customer_id,v_order.order_id);
  v_order.subtotal:=v_new_subtotal; v_order.vat_amount:=v_new_vat; v_order.total:=v_new_total;
 end if;
 return query select v_order.order_id,v_order.order_no,v_order.subtotal,v_order.vat_amount,v_order.total,v_discount;
end $$;
revoke all on function private.place_order_with_coupon(uuid,jsonb,text,payment_method,text) from public,anon,authenticated;
grant execute on function private.place_order_with_coupon(uuid,jsonb,text,payment_method,text) to authenticated;
create or replace function public.place_order_with_coupon(p_session_id uuid,p_items jsonb,p_notes text,p_payment_method payment_method,p_coupon_code text)
returns table(order_id uuid,order_no bigint,subtotal numeric,vat_amount numeric,total numeric,discount_amount numeric)
language sql security invoker set search_path=pg_catalog,public,private as $$ select * from private.place_order_with_coupon(p_session_id,p_items,p_notes,p_payment_method,p_coupon_code) $$;
revoke all on function public.place_order_with_coupon(uuid,jsonb,text,payment_method,text) from public,anon;
grant execute on function public.place_order_with_coupon(uuid,jsonb,text,payment_method,text) to authenticated;


-- Honour a configured zero-points rate instead of forcing a minimum point.
create or replace function private.award_customer_order_points()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_rate numeric; v_points integer;
begin
 if new.status='paid' and old.status is distinct from 'paid' and new.customer_id is not null then
  select loyalty_points_per_currency into v_rate from public.settings where id=1;
  v_points:=floor(new.total*coalesce(v_rate,1))::integer;
  if v_points>0 then
   insert into public.customer_loyalty_ledger(customer_id,order_id,points)
   values(new.customer_id,new.id,v_points) on conflict(order_id) do nothing;
  end if;
 end if;
 return new;
end $$;
revoke all on function private.award_customer_order_points() from public,anon,authenticated;


create table if not exists public.loyalty_redemption_requests (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references public.customer_profiles(id) on delete cascade,
 reward_id uuid not null references public.loyalty_rewards(id) on delete restrict,
 points_spent integer not null check(points_spent>0),
 redemption_code text not null unique default ('RWD-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),
 status text not null default 'pending' check(status in ('pending','fulfilled','cancelled')),
 created_at timestamptz not null default now(),
 fulfilled_at timestamptz,
 fulfilled_by uuid references public.profiles(id)
);
create index if not exists loyalty_redemption_pending_idx on public.loyalty_redemption_requests(status,created_at desc);
alter table public.loyalty_redemption_requests enable row level security;
revoke all on public.loyalty_redemption_requests from anon,authenticated;
grant select,update on public.loyalty_redemption_requests to authenticated;
drop policy if exists loyalty_redemptions_customer_read on public.loyalty_redemption_requests;
create policy loyalty_redemptions_customer_read on public.loyalty_redemption_requests for select to authenticated using (private.is_customer_order_owner(customer_id));
drop policy if exists loyalty_redemptions_admin_read on public.loyalty_redemption_requests;
create policy loyalty_redemptions_admin_read on public.loyalty_redemption_requests for select to authenticated using ((select private.current_app_role())='admin');
drop policy if exists loyalty_redemptions_admin_update on public.loyalty_redemption_requests;
create policy loyalty_redemptions_admin_update on public.loyalty_redemption_requests for update to authenticated using ((select private.current_app_role())='admin') with check ((select private.current_app_role())='admin');

drop function if exists public.redeem_loyalty_reward(uuid);
drop function if exists private.redeem_loyalty_reward(uuid);
create or replace function private.redeem_loyalty_reward(p_reward_id uuid)
returns table(points_balance bigint,reward_title text,redemption_code text)
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare v_customer_id uuid; v_cost integer; v_title text; v_earned bigint; v_spent bigint; v_code text;
begin
 if auth.uid() is null then raise exception 'يلزم تسجيل الدخول'; end if;
 select id into v_customer_id from public.customer_profiles where auth_user_id=auth.uid() for update;
 if v_customer_id is null then raise exception 'ملف العميل غير موجود'; end if;
 select points_cost,title into v_cost,v_title from public.loyalty_rewards where id=p_reward_id and is_active=true;
 if v_cost is null then raise exception 'المكافأة غير متاحة'; end if;
 select coalesce(sum(points),0) into v_earned from public.customer_loyalty_ledger where customer_id=v_customer_id;
 select coalesce(sum(points_spent),0) into v_spent from public.loyalty_redemption_requests where customer_id=v_customer_id and status in ('pending','fulfilled');
 if v_earned-v_spent<v_cost then raise exception 'رصيد النقاط غير كافٍ'; end if;
 insert into public.loyalty_redemption_requests(customer_id,reward_id,points_spent) values(v_customer_id,p_reward_id,v_cost) returning loyalty_redemption_requests.redemption_code into v_code;
 return query select (v_earned-v_spent-v_cost)::bigint,v_title,v_code;
end $$;
revoke all on function private.redeem_loyalty_reward(uuid) from public,anon,authenticated;
grant execute on function private.redeem_loyalty_reward(uuid) to authenticated;
create or replace function public.redeem_loyalty_reward(p_reward_id uuid)
returns table(points_balance bigint,reward_title text,redemption_code text)
language sql security invoker set search_path=pg_catalog,public,private as $$ select * from private.redeem_loyalty_reward(p_reward_id) $$;
revoke all on function public.redeem_loyalty_reward(uuid) from public,anon;
grant execute on function public.redeem_loyalty_reward(uuid) to authenticated;

drop function if exists public.get_my_loyalty_summary();
drop function if exists private.get_my_loyalty_summary();
create or replace function private.get_my_loyalty_summary()
returns table(points_balance bigint,lifetime_points bigint,membership_level text)
language sql stable security definer set search_path=pg_catalog,public,private as $$
 select greatest(0,coalesce(sum(l.points),0)-coalesce((select sum(r.points_spent) from public.loyalty_redemption_requests r where r.customer_id=cp.id and r.status in ('pending','fulfilled')),0))::bigint,
        coalesce(sum(l.points),0)::bigint,
        case when coalesce(sum(l.points),0)>=5000 then 'ذهبي' when coalesce(sum(l.points),0)>=1000 then 'فضي' else 'أساسي' end
 from public.customer_profiles cp left join public.customer_loyalty_ledger l on l.customer_id=cp.id
 where cp.auth_user_id=auth.uid() group by cp.id
$$;
revoke all on function private.get_my_loyalty_summary() from public,anon,authenticated;
grant execute on function private.get_my_loyalty_summary() to authenticated;
create or replace function public.get_my_loyalty_summary()
returns table(points_balance bigint,lifetime_points bigint,membership_level text)
language sql stable security invoker set search_path=pg_catalog,public,private as $$ select * from private.get_my_loyalty_summary() $$;
revoke all on function public.get_my_loyalty_summary() from public,anon;
grant execute on function public.get_my_loyalty_summary() to authenticated;
