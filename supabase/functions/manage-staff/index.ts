import { withSupabase } from "npm:@supabase/server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

type StaffRole = "cashier" | "kitchen" | "waiter" | "admin";
type RequestBody =
  | { action: "list" }
  | { action: "invite"; email: string; full_name: string; role: StaffRole }
  | { action: "update"; user_id: string; role?: StaffRole; is_active?: boolean };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function isStaffRole(value: unknown): value is StaffRole {
  return value === "cashier" || value === "kitchen" || value === "waiter" || value === "admin";
}

const userHandler = withSupabase({ auth: "user" }, async (req, ctx) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const callerId = String(ctx.userClaims?.sub ?? "");
  if (!callerId) return json({ error: "Unauthenticated" }, 401);

  const { data: caller, error: callerError } = await ctx.supabase
    .from("profiles")
    .select("role,is_active")
    .eq("id", callerId)
    .maybeSingle();

  if (callerError || !caller || caller.is_active !== true || caller.role !== "admin") {
    return json({ error: "هذه العملية متاحة لمدير نشط فقط." }, 403);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const admin = ctx.supabaseAdmin;

  if (body.action === "list") {
    const [{ data: profiles, error: profilesError }, { data: authData, error: usersError }] =
      await Promise.all([
        admin.from("profiles")
          .select("id,full_name,role,is_active,created_at")
          .neq("role", "guest")
          .order("created_at", { ascending: false }),
        admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      ]);

    if (profilesError || usersError) {
      return json({ error: profilesError?.message ?? usersError?.message ?? "تعذر تحميل الموظفين." }, 500);
    }

    const users = new Map((authData?.users ?? []).map((user) => [user.id, user]));
    const staff = (profiles ?? []).map((profile) => {
      const user = users.get(profile.id);
      return {
        ...profile,
        email: user?.email ?? "",
        last_sign_in_at: user?.last_sign_in_at ?? null,
      };
    });
    return json({ staff });
  }

  if (body.action === "invite") {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const fullName = typeof body.full_name === "string" ? body.full_name.trim().slice(0, 120) : "";

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "أدخل بريداً إلكترونياً صحيحاً." }, 400);
    }
    if (!fullName || !isStaffRole(body.role)) {
      return json({ error: "الاسم والدور مطلوبان." }, 400);
    }

    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
    });
    if (error || !data.user) {
      return json({ error: error?.message ?? "تعذر إرسال الدعوة." }, 400);
    }

    const { error: profileError } = await admin.from("profiles").upsert({
      id: data.user.id,
      full_name: fullName,
      role: body.role,
      is_active: true,
    }, { onConflict: "id" });

    if (profileError) {
      return json({
        error: "تم إنشاء الدعوة لكن تعذر تعيين الدور. اطلب من المدير مراجعة ملف الموظف.",
        detail: profileError.message,
        user_id: data.user.id,
      }, 500);
    }

    await admin.from("audit_logs").insert({
      actor_id: callerId,
      action: "staff_invited",
      entity: "profiles",
      entity_id: data.user.id,
      meta: { email, role: body.role },
    });
    return json({ ok: true, user_id: data.user.id, message: "تم إرسال دعوة الموظف بالبريد." }, 201);
  }

  if (body.action === "update") {
    const userId = typeof body.user_id === "string" ? body.user_id : "";
    if (!/^[0-9a-f-]{36}$/i.test(userId) || userId === callerId) {
      return json({ error: "معرّف الموظف غير صحيح أو لا يمكن تعديل حساب المدير الحالي من هنا." }, 400);
    }

    const { data: target, error: targetError } = await admin.from("profiles")
      .select("id,role,is_active")
      .eq("id", userId)
      .maybeSingle();

    if (targetError || !target || target.role === "guest") {
      return json({ error: "الموظف غير موجود." }, 404);
    }
    if (body.role !== undefined && !isStaffRole(body.role)) {
      return json({ error: "الدور المحدد غير صالح." }, 400);
    }

    if (body.is_active === false && target.role === "admin") {
      const { count, error: countError } = await admin.from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin")
        .eq("is_active", true);
      if (countError) return json({ error: countError.message }, 500);
      if ((count ?? 0) <= 1) return json({ error: "لا يمكن تعطيل آخر مدير نشط." }, 409);
    }

    const patch: Record<string, unknown> = {};
    if (body.role !== undefined) patch.role = body.role;
    if (body.is_active !== undefined) patch.is_active = body.is_active;
    if (!Object.keys(patch).length) return json({ error: "لا توجد تغييرات." }, 400);

    const { error: updateError } = await admin.from("profiles").update(patch).eq("id", userId);
    if (updateError) return json({ error: updateError.message }, 500);

    await admin.from("audit_logs").insert({
      actor_id: callerId,
      action: "staff_updated",
      entity: "profiles",
      entity_id: userId,
      meta: patch,
    });
    return json({ ok: true, message: "تم تحديث بيانات الموظف." });
  }

  return json({ error: "Unknown action" }, 400);
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const response = await userHandler(req);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders)) headers.set(key, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch {
    return json({ error: "حدث خطأ غير متوقع في خدمة الموظفين." }, 500);
  }
});
