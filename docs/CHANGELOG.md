# Changelog

## 2026-11-26 — Foundation phase

- Added the monorepo workspace and six independent Next.js app entry points.
- Added the initial PostgreSQL schema, state enums, triggers, role helpers, RPC functions and RLS policies.
- Added product image storage bucket policies and Realtime publication membership.
- Added local-only sample seed and initial pgTAP schema/security checks.
- Documented architecture, access matrix, state machines and assumptions.

## Remaining before production

- Complete and run end-to-end tests across real staff/customer devices.
- Finish staff invite provisioning, all Admin modules, full POS/KDS/Waiter workflows, and menu CRUD.
- Enable Anonymous Sign-ins in Supabase Auth and verify CAPTCHA/rate limits.
- Configure Vercel projects, domains, secrets, monitoring and Lighthouse.
