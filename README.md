# منصة الطلب من الطاولة | Restaurant Table Ordering

Monorepo عربي RTL لمنصة طلب من الطاولة لمطعم واحد، مبني على Next.js وSupabase وPostgreSQL. يتضمن ستة تطبيقات منفصلة بهويات مختلفة: الموقع العام، تطبيق العميل، الكاشير، شاشة المطبخ، النادل، والإدارة.

> حالة التنفيذ: **المرحلة الأولى — الأساس وقاعدة البيانات**. بنية المستودع وملفات SQL وواجهات التطبيقات الابتدائية موجودة؛ لا تعتبر النسخة جاهزة للتشغيل التجاري قبل إكمال ربط كل الشاشات واختبارات القبول والنشر.

## التطبيقات

| التطبيق | المسار | منفذ التطوير |
|---|---|---:|
| الموقع العام | `apps/web` | 3000 |
| العميل | `/t/[qr]` في `apps/customer` | 3001 |
| الكاشير | `/pos` في `apps/pos` | 3002 |
| المطبخ | `/kds` في `apps/kds` | 3003 |
| النادل | `/waiter` في `apps/waiter` | 3004 |
| الإدارة | `/admin` في `apps/admin` | 3005 |

كل تطبيق يملك ملف `theme.css` منفصلاً. النطاقات المنفصلة في الإنتاج تتطلب ضبط `basePath` أو إعداد نطاق مستقل لكل مشروع Vercel.

## المتطلبات

- Node.js 22+
- pnpm 10+
- Supabase CLI 3.4+
- Docker لتشغيل Supabase المحلي

## التشغيل المحلي

1. انسخ `.env.example` إلى `.env.local` داخل كل تطبيق أو إلى إعدادات بيئة التطوير المناسبة.
2. ضع عنوان مشروع Supabase ومفتاح Publishable فقط في المتغيرات التي تبدأ بـ `NEXT_PUBLIC_`.
3. شغّل `supabase start` ثم `supabase db reset` لتطبيق migration وseed محلياً.
4. شغّل `pnpm install` ثم `pnpm dev`.

## متغيرات البيئة

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

لا تستخدم مفاتيح `sb_secret_*` أو `service_role` في المتصفح أو المستودع. إعدادات CI للخادم تحفظ في GitHub Actions Secrets فقط.

## قاعدة البيانات

- Migration أمان RPC: `supabase/migrations/20261126085531_rpc_security_hardening.sql`

- Migration: `supabase/migrations/20261126085311_initial_platform.sql`
- Seed تجريبي محلي: `supabase/seed.sql`
- pgTAP: `supabase/tests/platform_schema.test.sql`
- التوثيق: `docs/architecture.md`, `docs/rls-matrix.md`, `docs/state-machines.md`

كل التسعيرات والضريبة والإجماليات تحسب في Postgres RPC، ولا تثق قاعدة البيانات بأي سعر يرسله المتصفح. لا توجد بوابة دفع؛ الدفع نقداً أو شبكة ويسجله النادل.

## النشر

- أنشئ ستة مشاريع Vercel واربط جذر كل مشروع بمجلد التطبيق المقابل.
- أضف متغيرات Supabase العامة لكل تطبيق.
- أضف `SUPABASE_ACCESS_TOKEN` و`SUPABASE_DB_PASSWORD` إلى GitHub Actions Secrets.
- CLI v3 يعمل محلياً افتراضياً؛ ينشر CI التغييرات المستضافة باستخدام `supabase db push --remote --yes`.

## الأمان

- RLS مفعّل على كل جداول `public`.
- دوال `SECURITY DEFINER` الداخلية معزولة في schema غير مكشوف، ودوال RPC العامة لها صلاحيات تنفيذ صريحة.
- أدوار الموظفين لا تنشأ عن طريق تسجيل ذاتي.
- مفاتيح Supabase السرية لا تدخل إلى تطبيقات المتصفح.

انظر `docs/ASSUMPTIONS.md` للقرارات والقيود المعروفة.
