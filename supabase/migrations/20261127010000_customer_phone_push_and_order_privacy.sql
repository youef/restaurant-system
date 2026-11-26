-- Customer visit identity, private push subscriptions, and per-guest order visibility.
create table if not exists public.customer_contacts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\\+9665[0-9]{8}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.customer_contacts enable row level security;
create policy customer_contacts_select_own on public.customer_contacts
  for select to authenticated
  using (user_id = (select auth.uid()) and coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false));
create policy customer_contacts_insert_own on public.customer_contacts
  for insert to authenticated
  with check (user_id = (select auth.uid()) and coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false));
create policy customer_contacts_update_own on public.customer_contacts
  for update to authenticated
  using (user_id = (select auth.uid()) and coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false))
  with check (user_id = (select auth.uid()) and coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false));

create table if not exists public.customer_push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null,
  auth_secret text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customer_push_subscriptions_user_id_idx
  on public.customer_push_subscriptions(user_id);
alter table public.customer_push_subscriptions enable row level security;
create policy customer_push_subscriptions_select_own on public.customer_push_subscriptions
  for select to authenticated
  using (user_id = (select auth.uid()) and coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false));
create policy customer_push_subscriptions_insert_own on public.customer_push_subscriptions
  for insert to authenticated
  with check (user_id = (select auth.uid()) and coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false));
create policy customer_push_subscriptions_update_own on public.customer_push_subscriptions
  for update to authenticated
  using (user_id = (select auth.uid()) and coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false))
  with check (user_id = (select auth.uid()) and coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false));
create policy customer_push_subscriptions_delete_own on public.customer_push_subscriptions
  for delete to authenticated
  using (user_id = (select auth.uid()) and coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false));

create policy orders_guest_own_rows_only on public.orders
  as restrictive for select to authenticated
  using (
    private.current_app_role() <> 'guest'
    or (private.is_session_member(session_id) and placed_by = (select auth.uid()))
  );
create policy order_items_guest_own_rows_only on public.order_items
  as restrictive for select to authenticated
  using (
    private.current_app_role() <> 'guest'
    or exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and private.is_session_member(o.session_id)
        and o.placed_by = (select auth.uid())
    )
  );
