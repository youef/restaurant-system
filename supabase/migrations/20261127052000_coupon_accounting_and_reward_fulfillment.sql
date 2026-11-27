-- Correct coupon accounting. Loyalty redemption is stored in the existing
-- public.loyalty_redemption_requests table created by the preceding migration.

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

-- Remove the unused duplicate redemption store; the live reward workflow uses
-- public.loyalty_redemption_requests with admin fulfilment and customer RLS.
drop function if exists public.list_pending_loyalty_redemptions();
drop function if exists private.list_pending_loyalty_redemptions();
drop function if exists public.fulfill_loyalty_redemption(uuid);
drop function if exists private.fulfill_loyalty_redemption(uuid);
drop function if exists public.redeem_loyalty_reward(uuid);
drop function if exists private.redeem_loyalty_reward(uuid);
drop table if exists private.customer_loyalty_redemptions cascade;
