-- Customer configuration and server-priced cart preview.
alter table public.settings
  add column if not exists customer_app_url text;

create or replace function private.is_session_member(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    and exists (
      select 1
      from public.session_members sm
      where sm.session_id = p_session_id
        and sm.user_id = auth.uid()
    )
$$;

create or replace function private.preview_order(
  p_session_id uuid,
  p_items jsonb
)
returns table(subtotal numeric, vat_amount numeric, total numeric)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_subtotal numeric(10,2);
  v_vat_rate numeric(5,4);
  v_vat_amount numeric(10,2);
  v_total numeric(10,2);
  v_count integer;
begin
  if private.current_app_role() is distinct from 'guest'
     or not private.is_session_member(p_session_id) then
    raise exception 'لا تملك صلاحية التسعير لهذه الجلسة' using errcode = '42501';
  end if;

  perform 1 from public.table_sessions
  where id = p_session_id and status = 'open';
  if not found then
    raise exception 'الجلسة مغلقة أو غير موجودة' using errcode = 'P0002';
  end if;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'قائمة الأصناف غير صالحة';
  end if;

  select count(*) into v_count from jsonb_array_elements(p_items);
  if v_count < 1 or v_count > 30 then
    raise exception 'يجب أن تحتوي السلة من صنف واحد إلى 30 صنفاً';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity integer, notes text)
    left join public.products p on p.id = x.product_id
    where x.product_id is null
       or x.quantity is null
       or x.quantity < 1
       or x.quantity > 20
       or p.id is null
       or p.is_active is false
       or p.is_available is false
  ) then
    raise exception 'يوجد صنف غير متاح أو كمية غير صالحة';
  end if;

  select coalesce(sum(p.price * x.quantity), 0)::numeric(10,2)
  into v_subtotal
  from jsonb_to_recordset(p_items) as x(product_id uuid, quantity integer, notes text)
  join public.products p on p.id = x.product_id;

  select vat_rate into v_vat_rate from public.settings where id = 1;
  if v_vat_rate is null then
    raise exception 'لم يتم إعداد نسبة الضريبة';
  end if;

  v_total := round(v_subtotal * (1 + v_vat_rate), 2);
  v_vat_amount := v_total - v_subtotal;
  return query select v_subtotal, v_vat_amount, v_total;
end;
$$;

revoke all on function private.preview_order(uuid,jsonb) from public, anon;
grant execute on function private.preview_order(uuid,jsonb) to authenticated;

create or replace function public.preview_order(
  p_session_id uuid,
  p_items jsonb
)
returns table(subtotal numeric, vat_amount numeric, total numeric)
language sql
security invoker
set search_path = pg_catalog, public
as $$
  select * from private.preview_order(p_session_id,p_items)
$$;

revoke all on function public.preview_order(uuid,jsonb) from public, anon;
grant execute on function public.preview_order(uuid,jsonb) to authenticated;
