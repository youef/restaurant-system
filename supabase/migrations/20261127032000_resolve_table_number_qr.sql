-- Resolve a printed table-number QR to the private table token after guest identity verification.
create or replace function private.resolve_table_number(p_table_number integer)
returns table(qr_token uuid, table_number integer, status public.table_status)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null
     or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is not true
     or private.current_app_role() is distinct from 'guest' then
    raise exception 'سجل بيانات العميل أولاً' using errcode = '42501';
  end if;
  if p_table_number is null or p_table_number < 1 then
    raise exception 'رقم الطاولة غير صحيح' using errcode = '22023';
  end if;
  return query
    select t.qr_token, t.number, t.status
      from public.restaurant_tables t
     where t.number = p_table_number
     limit 1;
end;
$$;
revoke all on function private.resolve_table_number(integer) from public, anon, authenticated;
grant execute on function private.resolve_table_number(integer) to authenticated;

create or replace function public.resolve_table_number(p_table_number integer)
returns table(qr_token uuid, table_number integer, status public.table_status)
language sql
security invoker
set search_path = pg_catalog, public, private
as $$ select * from private.resolve_table_number(p_table_number) $$;
revoke all on function public.resolve_table_number(integer) from public, anon;
grant execute on function public.resolve_table_number(integer) to authenticated;
