import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

type OrderWebhook = {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: { id: string; order_no: number; placed_by: string; status: string };
  old_record?: { status?: string } | null;
};

const statusText: Record<string, string> = {
  pending: "تم استلام طلبك",
  approved: "تم اعتماد طلبك",
  preparing: "طلبك قيد التحضير",
  ready: "طلبك جاهز للاستلام",
  served: "تم تقديم طلبك",
  paid: "تم إغلاق الحساب",
  rejected: "تعذر تنفيذ الطلب",
};

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const webhookSecret = Deno.env.get("CUSTOMER_PUSH_WEBHOOK_SECRET");
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!webhookSecret || !vapidPublic || !vapidPrivate || !vapidSubject || !supabaseUrl || !secretKeysRaw) {
    return new Response("Push service is not configured", { status: 503 });
  }
  if (request.headers.get("authorization") !== "Bearer " + webhookSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: OrderWebhook;
  try {
    payload = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (payload.schema !== "public" || payload.table !== "orders" || payload.type !== "UPDATE" ||
      !payload.record?.placed_by || payload.old_record?.status === payload.record.status) {
    return Response.json({ skipped: true });
  }

  const keys = JSON.parse(secretKeysRaw);
  const apiKey = keys.default;
  if (!apiKey) return new Response("Supabase secret key is missing", { status: 503 });
  const supabase = createClient(supabaseUrl, apiKey, { auth: { persistSession: false } });
  const { data: subscriptions, error } = await supabase
    .from("customer_push_subscriptions")
    .select("endpoint,p256dh,auth_secret,target_url")
    .eq("user_id", payload.record.placed_by)
    .eq("enabled", true);
  if (error) return new Response("Could not load subscriptions", { status: 500 });

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
  const body = JSON.stringify({
    title: "تحديث الطلب #" + payload.record.order_no,
    body: statusText[payload.record.status] ?? "يوجد تحديث جديد على طلبك",
    tag: "order-" + payload.record.id,
    url: subscriptions?.[0]?.target_url ?? "/",
  });
  const results = await Promise.allSettled((subscriptions ?? []).map(async (subscription) => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth_secret },
      }, body);
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await supabase.from("customer_push_subscriptions").delete().eq("endpoint", subscription.endpoint);
      } else {
        throw error;
      }
    }
  }));
  return Response.json({ sent: results.filter((result) => result.status === "fulfilled").length });
});
