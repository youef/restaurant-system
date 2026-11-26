-- Reassert least-privilege grants after review of default Supabase API privileges.
revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;

grant select on public.settings, public.categories, public.products to anon, authenticated;
grant select on public.profiles, public.restaurant_tables, public.table_sessions,
  public.session_members, public.orders, public.order_items,
  public.bill_requests, public.payments, public.audit_logs to authenticated;
grant insert, update, delete on public.categories, public.products to authenticated;
grant update on public.profiles, public.settings to authenticated;
