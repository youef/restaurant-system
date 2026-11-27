-- Correct coupon accounting and make loyalty rewards operationally redeemable.
create or replace function private.preview_order_with_coupon(p_session_id uuid,p_items jsonb,p_coupon_code text)
returns table(subtotal numeric,vat_amount numeric,total numeric,discount_amount numeric)
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare v_base record; v_coupon public.coupons%rowtype; v_customer_id uuid; v_discount numeric:=0; v_vat_rate numeric; v_net numeric;
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
 subtotal:=v_base.subtotal; v_net:=subtotal-v_discount; vat_amount:=round(v_net*v_vat_rate,2); total:=v_net+vat_amount; discount_amount:=v_discount;
 return next;
end $$;

create or replace function private.place_order_with_coupon(p_session_id uuid,p_items jsonb,p_notes text,p_payment_method payment_method,p_coupon_code text)
returns table(order_id uuid,order_no bigint,subtotal numeric,vat_amount numeric,total numeric,discount_amount numeric)
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare v_order record; v_coupon public.coupons%rowtype; v_customer_id uuid; v_discount numeric:=0; v_vat_rate numeric; v_new_vat numeric; v_new_total numeric;
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
  v_new_vat:=round((v_order.subtotal-v_discount)*v_vat_rate,2); v_new_total:=v_order.subtotal-v_discount+v_new_vat;
  update public.orders set vat_amount=v_new_vat,total=v_new_total,discount_amount=v_discount,coupon_code=upper(trim(p_coupon_code)) where id=v_order.order_id;
  insert into private.customer_coupon_redemptions(coupon_id,customer_id,order_id) values(v_coupon.id,v_customer_id,v_order.order_id);
  v_order.vat_amount:=v_new_vat; v_order.total:=v_new_total;
 end if;
 return query select v_order.order_id,v_order.order_no,v_order.subtotal,v_order.vat_amount,v_order.total,v_discount;
end $$;

alter table private.customer_loyalty_redemptions add column if not exists status text not null default 'pending' check(status in ('pending','fulfilled','cancelled'));
alter table private.customer_loyalty_redemptions add column if not exists redemption_code text not null default ('RW-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)));
alter table private.customer_loyalty_redemptions add column if not exists fulfilled_at timestamptz;
alter table private.customer_loyalty_redemptions add column if not exists fulfilled_by uuid references public.profiles(id);

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
 select coalesce(sum(points_spent),0) into v_spent from private.customer_loyalty_redemptions where customer_id=v_customer_id and status<>'cancelled';
 if v_earned-v_spent<v_cost then raise exception 'رصيد النقاط غير كافٍ'; end if;
 v_code:='RW-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
 insert into private.customer_loyalty_redemptions(customer_id,reward_id,points_spent,redemption_code) values(v_customer_id,p_reward_id,v_cost,v_code);
 return query select (v_earned-v_spent-v_cost)::bigint,v_title,v_code;
end $$;
revoke all on function private.redeem_loyalty_reward(uuid) from public,anon,authenticated;
grant execute on function private.redeem_loyalty_reward(uuid) to authenticated;
create or replace function public.redeem_loyalty_reward(p_reward_id uuid)
returns table(points_balance bigint,reward_title text,redemption_code text)
language sql security invoker set search_path=pg_catalog,public,private as $$ select * from private.redeem_loyalty_reward(p_reward_id) $$;
revoke all on function public.redeem_loyalty_reward(uuid) from public,anon;
grant execute on function public.redeem_loyalty_reward(uuid) to authenticated;

create or replace function private.list_pending_loyalty_redemptions()
returns table(id uuid,customer_name text,reward_title text,points_spent integer,redemption_code text,created_at timestamptz)
language plpgsql stable security definer set search_path=pg_catalog,public,private as $$
begin
 if coalesce((select private.current_app_role()),'') not in ('admin','waiter') then raise exception 'غير مصرح'; end if;
 return query select r.id,'عميل · '||right(cp.phone_e164,4),lr.title,r.points_spent,r.redemption_code,r.redeemed_at
 from private.customer_loyalty_redemptions r join public.customer_profiles cp on cp.id=r.customer_id join public.loyalty_rewards lr on lr.id=r.reward_id
 where r.status='pending' order by r.redeemed_at;
end $$;
revoke all on function private.list_pending_loyalty_redemptions() from public,anon,authenticated;
grant execute on function private.list_pending_loyalty_redemptions() to authenticated;
create or replace function public.list_pending_loyalty_redemptions()
returns table(id uuid,customer_name text,reward_title text,points_spent integer,redemption_code text,created_at timestamptz)
language sql stable security invoker set search_path=pg_catalog,public,private as $$ select * from private.list_pending_loyalty_redemptions() $$;
revoke all on function public.list_pending_loyalty_redemptions() from public,anon;
grant execute on function public.list_pending_loyalty_redemptions() to authenticated;

create or replace function private.fulfill_loyalty_redemption(p_redemption_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,private as $$
begin
 if auth.uid() is null or coalesce((select private.current_app_role()),'') not in ('admin','waiter') then raise exception 'غير مصرح'; end if;
 update private.customer_loyalty_redemptions set status='fulfilled',fulfilled_at=now(),fulfilled_by=auth.uid() where id=p_redemption_id and status='pending';
 return found;
end $$;
revoke all on function private.fulfill_loyalty_redemption(uuid) from public,anon,authenticated;
grant execute on function private.fulfill_loyalty_redemption(uuid) to authenticated;
create or replace function public.fulfill_loyalty_redemption(p_redemption_id uuid)
returns boolean language sql security invoker set search_path=pg_catalog,public,private as $$ select private.fulfill_loyalty_redemption(p_redemption_id) $$;
revoke all on function public.fulfill_loyalty_redemption(uuid) from public,anon;
grant execute on function public.fulfill_loyalty_redemption(uuid) to authenticated;
