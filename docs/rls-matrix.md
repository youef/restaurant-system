# RLS matrix

All public application tables have Row Level Security enabled.

| Table | anon | guest | cashier | kitchen | waiter | admin |
|---|---|---|---|---|---|---|
| categories/products | active read | active read | read | read | read | CRUD |
| settings | read | read | read | read | read | read/update |
| restaurant_tables | none | none | read | read | read | read via policies/RPC |
| table_sessions | none | member only | read | none | read | read |
| session_members | none | self | read | self | read | read |
| orders | none | own session | all | approved/preparing/ready | ready/served + bill sessions | all |
| order_items | none | own order | all | visible order | visible order | all |
| bill_requests | none | own session | read | none | read | read |
| payments | none | own session | read | none | read | read |
| audit_logs | none | none | none | none | none | read |
| profiles | none | none | self | self | self | all |

Sensitive writes are intentionally not granted on orders, order_items, payments, bill_requests, sessions or tables. The RPC functions validate role, ownership and state transitions inside Postgres.


## SQL privileges in addition to RLS

The migration explicitly revokes all table/sequence privileges from `anon` and `authenticated` in the `public` schema, then grants only:

- Anonymous and authenticated read of settings, active catalogue rows (filtered by RLS).
- Authenticated read of operational records, further filtered by each role's RLS policy.
- Authenticated write privileges on catalogue tables and updates to settings/profiles; RLS limits those changes to admins.
- No direct write grants on orders, order items, tables, sessions, bill requests, payments, or audit logs.
