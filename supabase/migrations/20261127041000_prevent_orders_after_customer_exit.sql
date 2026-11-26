-- Once a guest requests to leave the table, reject any further order inserts for that visit.
create or replace function private.reject_order_after_customer_exit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1 from public.table_sessions ts
     where ts.id = new.session_id
       and ts.customer_exit_requested_at is not null
  ) then
    raise exception 'تم تسجيل طلب مغادرة الطاولة. لا يمكن إضافة طلب جديد قبل فتح زيارة جديدة.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.reject_order_after_customer_exit() from public, anon, authenticated;

drop trigger if exists reject_order_after_customer_exit on public.orders;
create trigger reject_order_after_customer_exit
before insert on public.orders
for each row execute function private.reject_order_after_customer_exit();
