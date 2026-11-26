# البريمت الشامل: منصة الطلب من الطاولة للمطاعم (Table Ordering Platform)

> هذا الملف تعليمات بناء كاملة. انسخه والصقه في وكيل برمجي (Claude Code أو غيره) داخل مجلد فارغ، ثم اتبع المراحل بالترتيب.

---

## 0. دورك

أنت مهندس برمجيات أول (Senior Full-Stack Engineer) ومصمم منتجات (Product Designer). مهمتك بناء المشروع كاملاً من الصفر داخل مستودع GitHub، بما في ذلك:
- قاعدة البيانات على Supabase (migrations + RLS + RPC + Realtime)
- ستة تطبيقات ويب، كل واحد بتصميم وتجربة مختلفة
- وثائق كاملة داخل المستودع
- اختبارات تغطي كل سيناريو عمل

**قواعد العمل:**
1. لا تسأل أسئلة. عند الغموض، اختر الافتراض الأنسب وسجّله في `docs/ASSUMPTIONS.md`.
2. نفّذ بالمراحل في القسم 13، وفي نهاية كل مرحلة: اختبارات خضراء + commit واضح + تحديث README.
3. كل نص يظهر للمستخدم بالعربية أولاً (RTL)، مع دعم الإنجليزية في الإعدادات.
4. لا تضع أي مفتاح سري في الواجهة الأمامية. فقط `anon key`. مفتاح `service_role` يستخدم في الـ migrations والـ scripts فقط.
5. لا تستخدم أي بوابة دفع إلكترونية. الدفع يُسجَّل يدوياً من النادل (نقد أو شبكة) ويُغلق الحساب.

---

## 1. الهدف والنطاق

مطعم واحد (فرع واحد الآن، والتصميم يسمح بالتوسع لاحقاً لعدة فروع). العميل يمسح باركود الطاولة، يتصفح المنيو، يرسل طلبه، يتابع حالته لحظياً، ويطلب الحساب من النادل. كل ذلك بدون بوابة دفع.

**المكونات الستة:**

| التطبيق | المسار | الجهاز الأساسي | الوظيفة |
|---|---|---|---|
| `apps/web` | الموقع العام | جوال + ديسكتوب | موقع المطعم، المنيو للعرض، الموقع والدوام، كيف تطلب |
| `apps/customer` | `/t/[qr]` | جوال أولاً (PWA) | طلب العميل ومتابعته وطلب الحساب |
| `apps/pos` | `/pos` | تابلت أفقي / ديسكتوب | الكاشير: موافقة الطلبات ومتابعة الحسابات |
| `apps/kds` | `/kds` | شاشة كبيرة / تلفاز / تابلت | شاشة المطبخ والعمال |
| `apps/waiter` | `/waiter` | جوال (PWA) | النادل: التقديم واستلام الدفع |
| `apps/admin` | `/admin` | ديسكتوب | لوحة التحكم: الطاولات، المنيو، الموظفون، التقارير |

**المبدأ:** كل واجهة لها هوية بصرية وتجربة مختلفة. لا يجوز أن يبدو أي تطبيقين متشابهين.

---

## 2. المعايير الثابتة

- **اللغة:** عربي أولاً، RTL. أسماء المنتجات والفئات ثنائية اللغة (`name_ar`, `name_en`).
- **العملة:** ريال سعودي (SAR)، عرض الأرقام بخط أحادي المسافة في شاشات الكاشير والمطبخ.
- **المنطقة الزمنية:** `Asia/Riyadh`.
- **الضريبة:** ضريبة القيمة المضافة 15% قابلة للتعديل من الإعدادات، وتُحسب على الخادم فقط.
- **إمكانية الوصول:** WCAG 2.1 AA، تباين لوني كافٍ، أهداف لمس لا تقل عن 44px (48px في تطبيق العميل).
- **الأداء:** تطبيق العميل يصل إلى LCP أقل من 2.5 ثانية على 4G متوسط، و Lighthouse ≥ 90 لصفحات العميل والموقع العام.
- **الحسابات المالية:** كل المجاميع تُحسب في قاعدة البيانات (RPC). الواجهة لا تحسب أي سعر ولا تثق فيه.

---

## 3. الأدوار والصلاحيات

| الدور | طريقة الدخول | يرى | يستطيع |
|---|---|---|---|
| `guest` (العميل) | Anonymous Auth عبر مسح الباركود | المنتجات المتاحة، طلبات جلسة طاولته فقط، حسابه | إرسال طلب، متابعة الحالة، طلب الحساب |
| `cashier` | بريد وكلمة مرور | الطلبات المعلّقة، الحسابات المفتوحة | موافقة أو رفض الطلب (مع سبب) |
| `kitchen` | بريد وكلمة مرور | الطلبات المعتمدة والمحضّرة والجاهزة | بدء التحضير، وتعليمها جاهزة |
| `waiter` | بريد وكلمة مرور | الطلبات الجاهزة، طلبات الحساب | تعليم التقديم، استلام الدفع وإغلاق الجلسة |
| `admin` | بريد وكلمة مرور + MFA مفضّل | كل شيء | المنيو، الطاولات، الموظفون، الإعدادات، التقارير، سجل العمليات |

- الموظفون لا يسجلون بأنفسهم. الـ admin يدعوهم من لوحة التحكم.
- الدور يُخزَّن في جدول `profiles` ويُقرأ داخل RLS عبر دالة `current_app_role()` بصلاحية `security definer`.
- كل تطبيق يتحقق من الدور في `middleware` ويعيد التوجيه إذا لم يطابق.

---

## 4. آلات الحالة (State Machines)

**الطلب (`order_status`):**

```
pending ──► approved ──► preparing ──► ready ──► served ──► paid
   │
   └──► rejected (يتطلب سبباً)
```

| من | إلى | من يُنفّذ |
|---|---|---|
| pending | approved / rejected | cashier, admin |
| approved | preparing | kitchen, admin |
| preparing | ready | kitchen, admin |
| ready | served | waiter, admin |
| served | paid | يحدث تلقائياً عند إغلاق الجلسة |

أي انتقال غير موجود في الجدول يُرفض على مستوى قاعدة البيانات، وليس في الواجهة فقط.

**حالة الطاولة (`table_status`):**

```
available ◄──► occupied        (تفتح الجلسة تلقائياً عند أول مسح، وتغلق عند الدفع)
    │  ▲
    ▼  │
 out_of_service                 (يضبطها admin فقط، ولا يمكن إن كانت الطاولة مشغولة)
```

- `occupied` لا يُضبط يدوياً. يضبطه النظام عند فتح الجلسة.
- الطاولة `out_of_service` لا تقبل مسح العميل، ويظهر له: "هذه الطاولة غير متاحة حالياً".

**الجلسة (`session_status`):** `open` ← ينشأ عند أول مسح. `closed` عند إغلاق الحساب. لا يوجد أكثر من جلسة مفتوحة واحدة لكل طاولة (partial unique index).

**طلب الحساب (`bill_status`):** `requested` ← `acknowledged` (النادل رآه) ← `closed` (تم الدفع).

---

## 5. قاعدة البيانات (Supabase / PostgreSQL)

### 5.1 الهيكل الأساسي (يجب أن تبني عليه، وتضيف ما يلزم)

```sql
-- ENUMS
create type app_role        as enum ('guest','cashier','kitchen','waiter','admin');
create type table_status    as enum ('available','occupied','out_of_service');
create type session_status  as enum ('open','closed');
create type order_status    as enum ('pending','approved','preparing','ready','served','paid','rejected');
create type bill_status     as enum ('requested','acknowledged','closed');
create type payment_method  as enum ('cash','card');
create type kitchen_station as enum ('kitchen','grill','bar','dessert');

-- المستخدمون
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role app_role not null default 'guest',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- الإعدادات (صف واحد)
create table settings (
  id int primary key default 1 check (id = 1),
  restaurant_name_ar text not null,
  restaurant_name_en text,
  vat_rate numeric(5,4) not null default 0.15,
  currency text not null default 'SAR',
  timezone text not null default 'Asia/Riyadh',
  logo_path text,
  phone text,
  address text,
  opening_hours jsonb not null default '{}'::jsonb
);

-- المنيو
create table categories (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null, name_en text,
  sort_order int not null default 0,
  is_active boolean not null default true
);
create table products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id),
  name_ar text not null, name_en text,
  description_ar text,
  price numeric(10,2) not null check (price >= 0),
  image_path text,
  station kitchen_station not null default 'kitchen',
  is_available boolean not null default true,   -- نفاد مؤقت
  is_active boolean not null default true,      -- حذف ناعم
  sort_order int not null default 0
);

-- الطاولات
create table restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  number int not null unique check (number > 0),
  seats int not null default 4 check (seats > 0),
  qr_token uuid not null unique default gen_random_uuid(),
  status table_status not null default 'available',
  updated_at timestamptz not null default now()
);

-- الجلسات والأعضاء
create table table_sessions (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references restaurant_tables(id),
  status session_status not null default 'open',
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index one_open_session_per_table on table_sessions(table_id) where status = 'open';
create table session_members (
  session_id uuid not null references table_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

-- الطلبات
create table orders (
  id uuid primary key default gen_random_uuid(),
  order_no bigint generated always as identity (start with 1001),
  session_id uuid not null references table_sessions(id),
  table_id uuid not null references restaurant_tables(id),
  status order_status not null default 'pending',
  subtotal numeric(10,2) not null,
  vat_amount numeric(10,2) not null,
  total numeric(10,2) not null,
  notes text,
  placed_by uuid not null references auth.users(id),
  placed_at timestamptz not null default now(),
  approved_at timestamptz, prepared_at timestamptz,
  ready_at timestamptz, served_at timestamptz,
  rejected_at timestamptz, rejected_reason text
);
create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid not null references products(id),
  name_ar text not null,                         -- لقطة من الاسم وقت الطلب
  unit_price numeric(10,2) not null,             -- لقطة من السعر وقت الطلب
  quantity int not null check (quantity > 0 and quantity <= 20),
  line_total numeric(10,2) not null,
  station kitchen_station not null,
  notes text
);

-- طلبات الحساب والدفع
create table bill_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references table_sessions(id),
  status bill_status not null default 'requested',
  requested_at timestamptz not null default now(),
  acknowledged_by uuid references auth.users(id), acknowledged_at timestamptz,
  closed_at timestamptz
);
create table payments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references table_sessions(id),
  method payment_method not null,
  amount numeric(10,2) not null check (amount >= 0),
  received_by uuid not null references auth.users(id),
  received_at timestamptz not null default now()
);

-- سجل العمليات
create table audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  action text not null,
  entity text not null,
  entity_id text,
  meta jsonb,
  created_at timestamptz not null default now()
);
```

**إضافات إلزامية:**
- Trigger لتحديث `updated_at` في `restaurant_tables`.
- Trigger لإنشاء `profiles` تلقائياً عند كل تسجيل في `auth.users` بدور `guest`.
- Trigger لتسجيل كل تغيير حالة في `audit_logs`.
- فهارس على: `orders(session_id)`, `orders(status)`, `orders(table_id, placed_at desc)`, `order_items(order_id)`, `bill_requests(session_id, status)`.

### 5.2 دوال RPC (`security definer`، مع `set search_path = public`)

كل عملية تغيّر البيانات تمر عبر دالة. لا يكتب التطبيق مباشرة في الجداول الحساسة.

| الدالة | من يستدعيها | ماذا تفعل |
|---|---|---|
| `resolve_table(qr uuid)` | عام | تعيد رقم الطاولة وحالتها فقط، بدون أي بيانات أخرى |
| `join_table_session(qr uuid)` | guest | تتحقق أن الطاولة ليست `out_of_service`، تفتح جلسة إن لم تكن موجودة وتضبط الطاولة `occupied`، تضيف المستخدم لـ `session_members` |
| `place_order(session uuid, items jsonb)` | guest عضو في الجلسة | تتحقق من الجلسة المفتوحة، تجلب الأسعار من `products` (تتجاهل أي سعر يرسله العميل)، ترفض المنتجات غير المتاحة، تحسب VAT من `settings`، تنشئ الطلب والأصناف |
| `advance_order(order uuid, to_status order_status, reason text)` | حسب الدور | تطبّق مصفوفة الانتقالات (القسم 4)، تضبط الطابع الزمني، تسجل في `audit_logs` |
| `request_bill(session uuid)` | guest عضو | تنشئ طلب حساب واحد مفتوح فقط |
| `acknowledge_bill(request uuid)` | waiter | تحوّل الحالة إلى `acknowledged` |
| `close_session(session uuid, method payment_method)` | waiter | تحسب الإجمالي من الطلبات غير المرفوضة، تسجّل الدفعة، تنقل الطلبات إلى `paid`، تغلق الجلسة، تضبط الطاولة `available` |
| `set_table_status(table uuid, status table_status)` | admin | ترفض `occupied` كقيمة يدوية، وترفض `out_of_service` إن كانت الطاولة مشغولة |
| `add_tables(count int, seats int)` | admin | تضيف طاولات بأرقام متتالية تكمل آخر رقم |

### 5.3 سياسات RLS (إلزامية على كل الجداول، بدون استثناء)

| الجدول | guest | cashier | kitchen | waiter | admin |
|---|---|---|---|---|---|
| `categories`, `products` | قراءة النشط فقط | قراءة | قراءة | قراءة | كامل (عبر السياسة) |
| `settings` | قراءة | قراءة | قراءة | قراءة | تعديل |
| `restaurant_tables` | لا (عبر `resolve_table`) | قراءة | قراءة | قراءة | كامل (عبر RPC) |
| `table_sessions` | الجلسات التي هو عضو فيها | قراءة | لا | قراءة | قراءة |
| `orders`, `order_items` | طلبات جلساته فقط | قراءة الكل | الحالات approved/preparing/ready | الحالات ready/served + طلبات الحساب | قراءة |
| `bill_requests`, `payments` | جلساته فقط | قراءة | لا | قراءة وتحديث | قراءة |
| `audit_logs` | لا | لا | لا | لا | قراءة |

**اختبارات RLS إلزامية (pgTAP):** عميل A لا يرى طلبات عميل B، وعميل لا يستدعي `advance_order`، وعميل لا يرى أي طاولة غير طاولته، وkitchen لا يرى `payments`.

### 5.4 Realtime وStorage

- أضف إلى `supabase_realtime` الجداول: `orders`, `order_items`, `bill_requests`, `restaurant_tables`, `table_sessions`, `products`.
- Storage bucket اسمه `product-images` بقراءة عامة، والكتابة للـ admin فقط.

---

## 6. المصادقة (Auth)

- **العميل:** تفعيل Anonymous Sign-ins في Supabase. عند أول مسح تُنشأ جلسة مجهولة تُحفظ في المتصفح. ترتبط بالجلسة عبر `join_table_session`.
- **الموظفون:** بريد وكلمة مرور. الـ admin يدعوهم عبر Supabase Auth Invite، ويُعيّن دورهم في `profiles`. لا يوجد تسجيل عام للموظفين.
- **الحماية:** `middleware.ts` في كل تطبيق يتحقق من الجلسة والدور. عند الفشل يُعاد التوجيه إلى صفحة دخول التطبيق نفسه.
- **الجلسة المجهولة:** تنتهي عند إغلاق الجلسة (`closed`) ويُمسح مرجعها من الجهاز.

---

## 7. تفصيل التطبيقات والتصميم

> **قاعدة التصميم:** لكل تطبيق ملف tokens مستقل (`theme.css`) وملف وثائق تصميم في `docs/design-system/`. الأشكال والخطوط والكثافة والحركة تختلف بين التطبيقات. المكونات الأساسية مشتركة في `packages/ui` لكنها تستقبل `variant` و`density` وتتلون من الـ tokens الخاصة بالتطبيق.

### 7.1 جدول الهوية البصرية

| التطبيق | الخلفية | السطح | اللون الأساسي | نجاح | تحذير | خطر | الخط | الكثافة |
|---|---|---|---|---|---|---|---|---|
| web | `#F5EFE6` كريمي | `#FFFFFF` | `#2F3B2A` زيتي عميق | `#6B8F4E` | `#D9A441` | `#B4483C` | Reem Kufi (عناوين) + IBM Plex Sans Arabic | هواء وفراغ |
| customer | `#FFFFFF` | `#F7F7F8` | `#FF6B4A` مرجاني | `#2BB673` | `#F5A524` | `#E5484D` | Cairo | لمس أولاً |
| pos | `#0E1116` | `#171B22` | `#00D4AA` فيروزي | `#22C55E` | `#F59E0B` | `#EF4444` | IBM Plex Sans Arabic + IBM Plex Mono للأرقام | كثيفة |
| kds | `#000000` | `#111111` | `#FFFFFF` أبيض | `#22C55E` | `#FACC15` | `#FF2D2D` | Cairo Bold | ضخمة جداً |
| waiter | رأس `#1B2A41` / جسم `#F3F5F9` | `#FFFFFF` | `#F4A259` برتقالي | `#3DDC97` | `#FFC857` | `#FF5D5D` | Tajawal | متوسطة |
| admin | `#F9FAFB` | `#FFFFFF` | `#4F46E5` نيلي | `#10B981` | `#F59E0B` | `#DC2626` | IBM Plex Sans Arabic | مريحة |

**ألوان حالة الطاولة موحّدة في كل التطبيقات:** متاحة = أخضر، مشغولة = أزرق، خارج الخدمة = رمادي مع شريط أحمر مائل.

### 7.2 `apps/web`: الموقع العام

**الهدف:** موقع احترافي يعرض المطعم ويشجع على المسح والطلب.

**الصفحات:**
- الرئيسية: Hero بصورة كبيرة وعنوان بخط Reem Kufi، شريط "امسح الباركود على طاولتك"، قسم "الأكثر طلباً" يُجلب من `products` بتصفية `is_featured` أو أعلى مبيعات، قسم "كيف تطلب؟" من 3 خطوات، قسم الموقع والدوام.
- القائمة: عرض للقراءة فقط مع فلترة الفئات والبحث، وتنبيه أن الطلب يتم من الطاولة بالباركود.
- عن المطعم، الموقع والدوام (خريطة رابط + ساعات من `settings.opening_hours`)، تواصل.

**التصميم:** تخطيط تحريري بخطوط كبيرة، شبكة غير متماثلة، صور بنسب واسعة، فراغ كثير، حركة هادئة عند التمرير (scroll reveal خفيف). الموقع يبدو كمطعم فاخر، لا كلوحة تحكم.

**تقنيات:** Next.js App Router، SSG للصفحات مع `revalidate`، Metadata وOpen Graph، `sitemap.xml`، `robots.txt`، Schema.org نوع `Restaurant`.

### 7.3 `apps/customer`: تطبيق العميل (PWA، الأولوية للجوال)

**المسار:** `/t/[qr]`. عند المسح تُفتح الصفحة مباشرة وتُربط بالطاولة.

**الشاشات:**
1. **الدخول/الترحيب:** اسم المطعم ورقم الطاولة. إذا كانت الطاولة خارج الخدمة تظهر شاشة توضيح بدون أي خطأ تقني.
2. **القائمة:** شريط فئات لاصق أعلى الشاشة. بطاقات منتجات بصورة وسعر وزر إضافة كبير. المنتج النافذ (`is_available = false`) يظهر مع شارة "غير متوفر" ولا يُضاف للسلة.
3. **السلة (Bottom Sheet):** كميات بأزرار كبيرة، ملاحظة لكل صنف، ملخص: المجموع قبل الضريبة، الضريبة 15%، الإجمالي. زر "أرسل الطلب".
4. **تأكيد الطلب:** رقم الطلب بخط ضخم، ورسوم احتفالية خفيفة.
5. **طلباتي (تتبّع حي):**
   - مخطط عمودي (Stepper): تم الإرسال ← معتمد ← قيد التحضير ← جاهز ← تم التقديم.
   - عداد يعدّ الوقت منذ الإرسال.
   - عبارة "⏳ جاري انتظار الطلب…" أثناء الانتظار، تتغير حسب الحالة.
6. **الحساب:** كل طلبات الجلسة، الإجمالي والضريبة، زر "اطلب النادل للدفع". بعد الطلب تظهر حالة "النادل في الطريق إليك". بعد الإغلاق تظهر "شكراً لزيارتكم".

**تجربة الجوال:**
- تصميم من 360px فما فوق. شريط تنقل سفلي: القائمة · السلة · طلباتي.
- أزرار 48px على الأقل، مسافات واسعة، أرقام بخط واضح.
- وضع داكن تلقائي حسب النظام، مع تحكم يدوي.
- الاهتزاز عند تغيّر الحالة إن كان الجهاز يدعمه (`navigator.vibrate`).
- عدم دعم الاتصال: تظهر آخر حالة معروفة مع تنبيه "لا يوجد اتصال، جاري إعادة المحاولة".

**PWA:** `manifest.webmanifest` بأيقونات 192 و512، Service Worker لتخزين الأصول الثابتة فقط (لا تخزين لبيانات الطلبات)، زر "أضف للشاشة الرئيسية" عند الحاجة.

**الخصوصية:** لا يرى العميل أي طاولة غير طاولته، ولا أي روابط للوحات الموظفين.

### 7.4 `apps/pos`: الكاشير

**المستخدم:** موظف واقف على تابلت أو شاشة كاونتر.

**التخطيط (أفقي):**
- **يسار:** قائمة الطلبات المعلّقة (`pending`) كبطاقات مرتبة من الأقدم، كل بطاقة: رقم الطلب بخط أحادي المسافة، رقم الطاولة، عمر الطلب.
- **يمين:** تفاصيل الطلب المحدد: الأصناف، الكميات، الملاحظات، الإجمالي شامل الضريبة. زرا "موافقة" و"رفض".
- **تبويب ثانٍ "الحسابات":** جدول الجلسات المفتوحة: الطاولة، مدة الجلسة، الإجمالي، شارة "طلب حساب" عند وجود طلب.

**التفاعل:**
- اختصارات لوحة المفاتيح: `A` موافقة، `R` رفض (يفتح نافذة السبب)، `↑↓` التنقل.
- الرفض يتطلب سبباً من قائمة جاهزة (نفاد المنتج، خطأ في الطلب، طاولة غير صحيحة) أو نص حر.
- تنبيه صوتي قصير عند وصول طلب جديد (يتطلب تفاعلاً أولياً من المستخدم لتفعيل الصوت).

**التصميم:** وضع داكن كالتيرمينال، كثافة عالية، أرقام بخط Plex Mono، حدود حادة وبلا ظلال، ألوان الحالة واضحة. يجب أن يكون الكاشير قادراً على إنهاء عشرين طلباً في دقيقة.

### 7.5 `apps/kds`: شاشة المطبخ والعمال

**المستخدم:** الطباخون والعمال، والشاشة تُعرض من بعيد.

**التخطيط:**
- ثلاثة أعمدة: **جديد** (`approved`) ← **قيد التحضير** (`preparing`) ← **جاهز** (`ready`، يبقى ظاهراً حتى التقديم).
- أعلى الشاشة تبويبات ضخمة للمحطات: الكل · المطبخ · الشواية · البار · الحلويات.
- كل تذكرة: رقم الطلب بخط ضخم (72px فما فوق)، رقم الطاولة، الأصناف بخط 28px على الأقل، وعداد زمني.

**ألوان العداد الزمني:**
- أخضر: أقل من 5 دقائق
- أصفر: من 5 إلى 10 دقائق
- أحمر: أكثر من 10 دقائق
- أحمر وامض: أكثر من 15 دقيقة

**التفاعل:** نقرة واحدة على التذكرة تنقلها للمرحلة التالية. لا يعتمد على التمرير الدقيق أو hover أبداً. مناطق اللمس كبيرة جداً.

**الاستمرارية:** Wake Lock API لمنع إطفاء الشاشة، وإعادة الاتصال تلقائياً عند انقطاع الشبكة، وصوت عند وصول تذكرة جديدة.

**التصميم:** خلفية سوداء، نص أبيض، لا صور، لا تدرجات، تباين عالٍ جداً. وضوح من مسافة 5 أمتار هو المعيار.

### 7.6 `apps/waiter`: تطبيق النادل (PWA، جوال)

**المستخدم:** نادل يتنقل بين الطاولات ويحمل جواله.

**التبويبات السفلية:**
1. **الطاولات:** شبكة بطاقات الطاولات بلونها حسب الحالة، وعلى كل مشغولة عدد الأصناف الجاهزة وشارة "طلب حساب" عند وجوده.
2. **المهام:** قائمة مرتبة: أولاً طلبات الحساب، ثم الطلبات الجاهزة للتقديم.

**الإجراءات:**
- "تم التقديم": زر كبير أو سحب بطاقة يميناً.
- "استلام الدفع": يفتح ورقة سفلية تعرض الإجمالي شامل الضريبة، وتختار طريقة الدفع (نقد أو شبكة)، وإن كان نقداً تحسب الباقي عند إدخال المبلغ المستلم. زر "إغلاق الحساب" يستدعي `close_session`.

**التنبيهات:** اهتزاز + صوت عند طلب حساب جديد أو طلب جاهز.

**التصميم:** رأس كحلي وجسم فاتح، برتقالي للإجراءات، خط Tajawal بأحجام مريحة للقراءة السريعة أثناء الحركة. كل الأزرار كبيرة للإبهام.

### 7.7 `apps/admin`: لوحة التحكم

**المستخدم:** المدير، على الديسكتوب بالدرجة الأولى، مع تجاوب مقبول للتابلت.

**التخطيط:** شريط جانبي قابل للطي، رأس بتنبيهات، محتوى بتباعد مريح.

**الوحدات:**

**1. الرئيسية (Dashboard):**
- بطاقات KPI: مبيعات اليوم، عدد الطلبات، متوسط زمن التحضير، عدد الطاولات (متاحة / مشغولة / خارج الخدمة).
- مخطط المبيعات بالساعة (Recharts)، وأكثر الأصناف مبيعاً.
- "آخر الطلبات" مباشرة عبر Realtime.

**2. الطاولات (الوحدة المطلوبة بدقة):**
- أعلى الصفحة ثلاث بطاقات ملخص بالأرقام: **متاحة: X** · **مشغولة: Y** · **خارج الخدمة: Z**.
- زر **"إضافة طاولات"**: يفتح نافذة فيها حقل "عدد الطاولات" وحقل "عدد المقاعد الافتراضي"، ويستدعي `add_tables`. الأرقام تكمل من آخر رقم موجود.
- شبكة بطاقات لكل طاولة: الرقم الكبير، المقاعد، شارة الحالة بلونها، والجلسة الحالية إن وُجدت (المدة والإجمالي).
- تغيير الحالة من قائمة منسدلة: متاحة / خارج الخدمة. "مشغولة" تظهر للعرض فقط، ولا تُختار يدوياً. تحويل إلى "خارج الخدمة" من طاولة مشغولة يُرفض مع رسالة واضحة.
- حذف طاولة مسموح فقط إن لم تكن لها جلسات مفتوحة. ويُمنع الحذف إن كانت لها جلسات سابقة، بل تُوضع "خارج الخدمة".
- زر **"طباعة الباركودات"**: صفحة A4 بشبكة من بطاقات QR مع رقم الطاولة واسم المطعم، جاهزة للطباعة، لكل طاولة رابط `/t/{qr_token}`.

**3. القائمة:**
- الفئات: ترتيب بالسحب، تفعيل/تعطيل، ثنائية اللغة.
- المنتجات: الاسم بالعربية والإنجليزية، الوصف، السعر، الصورة (رفع إلى Storage مع ضغط تلقائي)، المحطة (مطبخ/شواية/بار/حلويات)، إتاحة مؤقتة (نفاد)، تفعيل/تعطيل.

**4. الموظفون:** دعوة بالبريد، تعيين الدور، تفعيل/تعطيل الحساب، آخر دخول.

**5. التقارير:** اختيار الفترة، مبيعات وعدد طلبات وضريبة حسب اليوم والصنف والساعة، تصدير CSV.

**6. سجل العمليات:** جدول `audit_logs` قابل للتصفية بالموظف والعملية والتاريخ.

**7. الإعدادات:** اسم المطعم، الشعار، الهاتف، العنوان، ساعات الدوام، نسبة الضريبة، اللغة الافتراضية.

**التصميم:** نظيف كمنتج SaaS حديث، أبيض ورمادي فاتح، نيلي للأزرار الأساسية، جداول واضحة مع فرز وبحث، ظلال خفيفة، زوايا 12px، لا زخرفة زائدة.

---

## 8. الحزم المشتركة (`packages/`)

| الحزمة | المحتوى |
|---|---|
| `packages/db` | الأنواع المولّدة من Supabase (`supabase gen types`)، دوال استعلام مُكتبة، مخططات Zod لكل مدخلات RPC |
| `packages/ui` | مكونات أساسية: Button، Card، Badge، Dialog، Sheet، Toast، Stepper، Timer، Money، TableStatusChip. تستقبل `variant` و`density` وتعتمد CSS variables |
| `packages/realtime` | Hooks: `useOrdersFeed(role)`، `useTables()`، `useBillRequests()`، مع إعادة اتصال وإلغاء اشتراك صحيح |
| `packages/i18n` | نصوص عربية وإنجليزية، تنسيق الأرقام والعملة والتاريخ بـ `Intl` (ar-SA، SAR) |
| `packages/config` | إعدادات ESLint وTypeScript وTailwind المشتركة |

---

## 9. هيكل المستودع (Monorepo)

```
restaurant-platform/
├─ apps/
│  ├─ web/            # الموقع العام
│  ├─ customer/       # تطبيق العميل PWA
│  ├─ pos/            # الكاشير
│  ├─ kds/            # شاشة المطبخ
│  ├─ waiter/         # تطبيق النادل PWA
│  └─ admin/          # لوحة التحكم
├─ packages/
│  ├─ db/ ui/ realtime/ i18n/ config/
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/     # كل تغيير في ملف مستقل مرقّم بالتاريخ
│  ├─ seed.sql        # منيو تجريبي + 8 طاولات
│  └─ tests/          # pgTAP لاختبار RLS والـ RPC
├─ tests/
│  └─ e2e/            # Playwright: سيناريوهات كاملة (القسم 12)
├─ docs/
│  ├─ README.ar.md    # دليل الإعداد بالعربية
│  ├─ architecture.md
│  ├─ erd.md          # مخطط العلاقات (Mermaid)
│  ├─ rls-matrix.md
│  ├─ state-machines.md
│  ├─ design-system/  # ملف لكل تطبيق: web.md, customer.md, pos.md, kds.md, waiter.md, admin.md
│  ├─ ASSUMPTIONS.md
│  └─ CHANGELOG.md
├─ .github/workflows/ci.yml
├─ .env.example
├─ turbo.json  pnpm-workspace.yaml  package.json  LICENSE  README.md
```

---

## 10. الإعداد والبيئات

- **Supabase:** مشروعان، `staging` و`production`. الـ migrations تُطبَّق عبر `supabase db push` فقط، ولا تُعدّل يدوياً في لوحة التحكم.
- **متغيرات البيئة لكل تطبيق:** `NEXT_PUBLIC_SUPABASE_URL` و`NEXT_PUBLIC_SUPABASE_ANON_KEY`. لا شيء آخر في الواجهة.
- **النشر:** ستة مشاريع منفصلة على Vercel (أو منصة مشابهة)، لكل تطبيق نطاق فرعي مثل `menu.`, `pos.`, `kds.`, `waiter.`, `admin.`, والموقع على النطاق الرئيسي.

---

## 11. CI/CD وجودة الكود

- GitHub Actions: `pnpm install` ← `lint` ← `typecheck` ← `unit tests` ← `supabase db lint` ← `pgTAP` ← `build` لكل تطبيق ← `Playwright e2e` على staging.
- قواعد: لا `any` في الكود. Zod على كل مدخل. Error Boundary في كل تطبيق. حالات تحميل (Skeleton) وفارغة (Empty State) وخطأ لكل قائمة.
- Commits بصيغة Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`).
- Pull Request template وCODEOWNERS لمجلد `supabase/`.

---

## 12. سيناريوهات القبول (E2E)

**السيناريو 1: الدورة الكاملة**
1. الـ admin يضيف 5 طاولات، فتظهر في الملخص: متاحة 5، مشغولة 0، خارج الخدمة 0.
2. العميل يمسح باركود الطاولة 3، فتتحول إلى مشغولة في لوحة الـ admin خلال ثانيتين.
3. يضيف العميل صنفين ويرسل الطلب، فيظهر رقم الطلب (مثلاً #1001) ويبدأ العداد.
4. الكاشير يرى الطلب فوراً، يوافق، فيظهر في شاشة المطبخ ضمن "جديد".
5. الطباخ ينقله "قيد التحضير" ثم "جاهز"، فيظهر للنادل.
6. النادل يعلّم "تم التقديم"، فتتغير حالة العميل إلى "تم التقديم".
7. العميل يضغط "اطلب النادل للدفع"، فيظهر للنادل بشارة، ويظهر للكاشير في "الحسابات".
8. النادل يستلم النقد، يحسب الباقي، يغلق الحساب، فتصبح الطاولة متاحة، ويرى العميل "شكراً لزيارتكم".

**السيناريو 2: حالات الحماية**
- طاولة خارج الخدمة: مسح الباركود يعرض رسالة واضحة ولا يفتح جلسة.
- تعديل السعر في الطلب من المتصفح: الخادم يتجاهله ويحسب السعر الحقيقي.
- عميل يحاول استدعاء `advance_order`: يُرفض.
- عميل A يحاول قراءة طلبات الجلسة B: لا تظهر أي نتيجة.
- محاولة تحويل طاولة مشغولة إلى خارج الخدمة: تُرفض برسالة.

**السيناريو 3: الاتصال المتقطع**
- قطع الشبكة أثناء تتبع الطلب: تظهر حالة "لا يوجد اتصال"، ويُعاد الاتصال تلقائياً، وتُحدَّث الحالة دون تحديث يدوي للصفحة.

---

## 13. المراحل والمعايير

| المرحلة | المخرجات | معيار الإنجاز |
|---|---|---|
| 1. الأساس | المستودع، pnpm/turbo، packages، Supabase migrations، seed، RLS، RPC، pgTAP | كل اختبارات pgTAP خضراء |
| 2. تطبيق العميل | الشاشات الست، PWA، Realtime | السيناريو 1 (الخطوات 2-4 و6-7) يعمل من جوال حقيقي |
| 3. الكاشير والمطبخ والنادل | POS، KDS، Waiter، Realtime، الأصوات | السيناريو 1 كاملاً يعمل بين أربعة أجهزة |
| 4. لوحة التحكم | Dashboard، الطاولات، القائمة، الموظفون، التقارير، السجل، الإعدادات | إضافة الطاولات وتغيير الحالات وطباعة الباركودات تعمل بالكامل |
| 5. الموقع العام | الصفحات، SEO، Schema، Sitemap | Lighthouse ≥ 90 |
| 6. الجودة والتلميع | Playwright كامل، مراجعة إمكانية الوصول، تحسين الأداء، README | كل السيناريوهات خضراء، ولا أخطاء في Console |

**عند نهاية كل مرحلة:** حدّث `docs/CHANGELOG.md` وأضف لقطات شاشة لكل تطبيق في `docs/screenshots/`.

---

## 14. التسليم النهائي

1. إنشاء مستودع GitHub جديد، والدفع إليه بكل الـ commits والـ branches.
2. إنشاء ملف ZIP للمشروع كاملاً (بدون `node_modules` ولا `.env`).
3. `README.md` يحتوي: نظرة عامة، لقطات شاشة، تشغيل محلي بخطوات (`supabase start` ← `pnpm dev`)، متغيرات البيئة، النشر، بيانات الدخول التجريبية، ومخطط العلاقات.
4. قائمة الروابط النهائية: كل تطبيق ومساره، ولوحة التحكم.
5. ملخص قصير بالافتراضات المتخذة ومكان توثيقها في `docs/ASSUMPTIONS.md`.

---

## 15. ملاحظات أخيرة

- الأولوية القصوى هي **الدقة المالية** و**الأمان عبر RLS**، ثم **سهولة الاستخدام على الجوال**، ثم **الجمال**.
- لا تضف ميزات خارج النطاق (بوابات دفع، توصيل، نقاط ولاء) إلا إذا طُلبت صراحة.
- إذا تعارض قرار تصميمي مع القواعد الأمنية أو المالية، فالقاعدة الأمنية والمالية تُقدَّم وتُوثَّق في `docs/ASSUMPTIONS.md`.
