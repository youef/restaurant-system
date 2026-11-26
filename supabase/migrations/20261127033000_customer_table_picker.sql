-- Expose only table number, seat count and availability to a verified guest.
create or replace function private.list_customer_tables()
returns table(table_number integer, seats integer, status public.table_status)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null
     or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is not true
     or private.current_app_role() is distinct from 'guest'
     or not exists (
       select 1 from public.customer_profiles cp
       where cp.auth_user_id = auth.uid()
     ) then
    raise exception 'سجل بيانات العميل أولاً' using errcode = '42501';
  end if;

  return query
  select t.number,
         t.seats,
         case
           when t.status = 'out_of_service'::public.table_status then 'out_of_service'::public.table_status
           when t.status = 'occupied'::public.table_status
             or exists (
               select 1
               from public.table_sessions ts
               where ts.table_id = t.id
                 and ts.status = 'open'
                 and (
                   ts.reservation_expires_at is null
                   or ts.reservation_expires_at > now()
                   or exists (select 1 from public.orders o where o.session_id = ts.id)
                 )
             ) then 'occupied'::public.table_status
           else 'available'::public.table_status
         end
  from public.restaurant_tables t
  order by t.number;
end;
$function$;

revoke all on function private.list_customer_tables() from public, anon;
grant execute on function private.list_customer_tables() to authenticated;

create or replace function public.list_customer_tables()
returns table(table_number integer, seats integer, status public.table_status)
language sql
stable
security invoker
set search_path = ''
as $function$
  select * from private.list_customer_tables();
$function$;

revoke all on function public.list_customer_tables() from public, anon;
grant execute on function public.list_customer_tables() to authenticated;
