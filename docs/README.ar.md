# دليل الإعداد العربي

## 1. تجهيز Supabase

1. افتح المشروع المرتبط في Supabase.
2. دوّر أي مفاتيح سرية أو JWT secrets سبق مشاركتها خارج لوحة التحكم.
3. فعّل Anonymous Sign-Ins من Authentication > Providers.
4. تأكد من تفعيل Data API وRealtime.
5. استخدم `supabase/config.toml` وملفات migrations من المستودع كمصدر الحقيقة للمخطط.
6. لا تضع `sb_secret_*` أو `service_role` ضمن أي متغير يبدأ بـ `NEXT_PUBLIC_`.

## 2. التطوير المحلي

```bash
pnpm install
supabase start
supabase db reset
pnpm dev
```

## 3. عناوين التطوير

- الموقع العام: http://localhost:3000
- العميل: http://localhost:3001/t/{qr}
- الكاشير: http://localhost:3002/pos
- المطبخ: http://localhost:3003/kds
- النادل: http://localhost:3004/waiter
- الإدارة: http://localhost:3005/admin

## 4. اختبار قاعدة البيانات

```bash
supabase test db
supabase db lint
```

ملف الاختبار الأولي: `supabase/tests/platform_schema.test.sql`.

- migrations المطابقة لقاعدة البيانات: `20261126085311_initial_platform.sql` و`20261126085531_rpc_security_hardening.sql`.
- طبقة RPC العامة تستخدم `SECURITY INVOKER`، بينما تبقى عمليات الامتيازات في schema خاص غير مكشوف.

## 5. CI والنشر

يستخدم CLI v3 الخيارين `--remote --yes` للنشر المستضاف من CI. عيّن `SUPABASE_ACCESS_TOKEN` و`SUPABASE_DB_PASSWORD` كـ GitHub Secrets. عيّن `NEXT_PUBLIC_SUPABASE_URL` و`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` لكل تطبيق في Vercel.

لا تُنشئ حساب مدير بكلمة مرور ثابتة داخل seed. أنشئ أول مدير باستخدام مسار إدارة موثوق واحتفظ ببياناته خارج المستودع.
