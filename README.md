# منصة الطلب من الطاولة | Restaurant Table Ordering

Monorepo عربي RTL لمنصة طلب من الطاولة لمطعم واحد، مبني على Next.js وSupabase وPostgreSQL. يتضمن ستة تطبيقات منفصلة بهويات مختلفة: الموقع العام، تطبيق العميل، الكاشير، شاشة المطبخ، النادل، والإدارة.

> حالة التنفيذ: **الأساس وتدفقات التشغيل الرئيسية منفذة**. يشمل المستودع قاعدة البيانات المحمية، تطبيق العميل، الكاشير، المطبخ، النادل، ووحدات الإدارة الأساسية. ما زال تهيئة حساب المدير الأول، مفاتيح CI، ربط نطاقات الإنتاج، واختبار الأجهزة الحقيقية خطوات قبل التشغيل التجاري.

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
- `NEXT_PUBLIC_CUSTOMER_APP_URL` (عنوان تطبيق العميل الذي يُشفّر داخل QR)
- `NEXT_PUBLIC_SITE_URL` (عنوان الموقع العام لـ SEO)

لا تستخدم مفاتيح `sb_secret_*` أو `service_role` في المتصفح أو المستودع. إعدادات CI للخادم تحفظ في GitHub Actions Secrets فقط.

## قاعدة البيانات

- Migration سحب المنح الافتراضية: `supabase/migrations/20261126091713_revoke_default_api_table_grants.sql`.
- Migration تقوية منح الكتابة: `supabase/migrations/20261126091804_harden_write_grants.sql`.
- Migration عزل العميل المجهول: `supabase/migrations/20261126092801_anonymous_role_isolation.sql`.
- Migration معاينة الأسعار وحفظ سجل العميل: `supabase/migrations/20261126100224_customer_price_preview_and_receipt_access.sql`.

- Migration أمان RPC: `supabase/migrations/20261126085531_rpc_security_hardening.sql`

- Migration: `supabase/migrations/20261126085311_initial_platform.sql`
- Seed تجريبي محلي: `supabase/seed.sql`
- pgTAP: `supabase/tests/platform_schema.test.sql`
- التوثيق: `docs/architecture.md`, `docs/rls-matrix.md`, `docs/state-machines.md`

كل معاينة السلة والضريبة والإجماليات تحسب في Postgres RPC، ولا تثق قاعدة البيانات بأي سعر يرسله المتصفح. لا توجد بوابة دفع؛ الدفع نقداً أو شبكة ويسجله النادل.

## تهيئة حساب المدير الأول

1. فعّل Anonymous Sign-ins من Authentication > Providers؛ هذا مطلوب للعميل الذي يمسح QR.
2. من Authentication > Users أنشئ حساب المالك بالبريد الصحيح وأكّد الحساب.
3. افتح `supabase/bootstrap-first-admin.sql`، واستبدل `YOUR_OWNER_EMAIL@example.com` ببريد المالك، ثم شغّله مرة واحدة من SQL Editor.
4. سجّل الدخول من تطبيق الإدارة. بعد ذلك يمكن دعوة الكاشير والمطبخ والنادل والمديرين من وحدة الموظفين؛ تتم الدعوات عبر Edge Function `manage-staff` بصلاحية خادمية.
5. من الإعدادات احفظ عنوان تطبيق العميل الفعلي قبل طباعة QR.

لا توجد كلمات مرور تجريبية أو حسابات افتراضية في المستودع، ولا يُرفع أي مفتاح سري.

## النشر

- أنشئ ستة مشاريع Vercel واربط جذر كل مشروع بمجلد التطبيق المقابل.
- أضف متغيرات Supabase العامة لكل تطبيق.
- أضف `SUPABASE_ACCESS_TOKEN` و`SUPABASE_DB_PASSWORD` إلى GitHub Actions Secrets.
- CLI v3 يعمل محلياً افتراضياً؛ ينشر CI التغييرات المستضافة باستخدام `supabase db push --remote --yes`.

## التطبيقات ووظائفها

- العميل: منيو وفئات وبحث وسلة وملاحظات أصناف، وتسعير وضريبة من RPC، وتتبع لحظي وطلب الحساب ورسالة إغلاق.
- الكاشير: مراجعة الطلبات المعلقة وتفاصيل الأصناف والموافقة أو الرفض مع السبب، وعرض الجلسات المفتوحة.
- المطبخ: تذاكر حسب محطة التحضير مع وقت الانتظار ونقل الحالة.
- النادل: طاولات ومهام، وتقديم الطلبات، واستلام الدفع نقداً أو شبكة وحساب الباقي.
- الإدارة: الطاولات وQR، المنيو والصور والفئات، الموظفون والدعوات، الإعدادات، التقارير وCSV وسجل العمليات.
- الموقع العام: الرئيسية والمنيو وعن المطعم والموقع والتواصل من بيانات Supabase.

## الأمان

- RLS مفعّل على كل جداول `public`.
- دوال `SECURITY DEFINER` الداخلية معزولة في schema غير مكشوف، ودوال RPC العامة لها صلاحيات تنفيذ صريحة.
- أدوار الموظفين لا تنشأ عن طريق تسجيل ذاتي.
- مفاتيح Supabase السرية لا تدخل إلى تطبيقات المتصفح.

انظر `docs/ASSUMPTIONS.md` للقرارات والقيود المعروفة.
