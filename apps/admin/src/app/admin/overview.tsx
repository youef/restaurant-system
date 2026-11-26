"use client";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@restaurant/db/client";
import { useRealtimeRefresh } from "@restaurant/realtime";
import { formatMoney } from "@restaurant/i18n";

type Summary = {
  sales: number; orders: number; pending: number; avgPrep: number; openSessions: number; billRequests: number;
  tables: { available: number; occupied: number; out: number };
  top: { name: string; quantity: number; sales: number }[];
  recent: { id: string; order_no: number; status: string; total: number; placed_at: string }[];
};

export function AdminOverview() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [message, setMessage] = useState("");
  const orderRevision = useRealtimeRefresh("orders");
  const tableRevision = useRealtimeRefresh("restaurant_tables");
  const sessionRevision = useRealtimeRefresh("table_sessions");
  const billRevision = useRealtimeRefresh("bill_requests");

  useEffect(() => {
    let active = true;
    async function load() {
      const db = getSupabaseBrowserClient();
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const [ordersResult, pendingResult, tablesResult, sessionsResult, billsResult] = await Promise.all([
        db.from("orders").select("id,order_no,status,total,placed_at,paid_at,prepared_at,ready_at")
          .gte("placed_at", start).order("placed_at", { ascending: false }).limit(500),
        db.from("orders").select("id", { count: "exact", head: true }).eq("status", "pending"),
        db.from("restaurant_tables").select("status"),
        db.from("table_sessions").select("id", { count: "exact", head: true }).eq("status", "open"),
        db.from("bill_requests").select("id", { count: "exact", head: true }).in("status", ["requested", "acknowledged"]),
      ]);
      if (ordersResult.error || pendingResult.error || tablesResult.error || sessionsResult.error || billsResult.error) {
        setMessage(ordersResult.error?.message ?? pendingResult.error?.message ?? tablesResult.error?.message ?? sessionsResult.error?.message ?? billsResult.error?.message ?? "تعذر تحميل المؤشرات.");
        return;
      }
      const rows = ordersResult.data ?? [];
      const paid = rows.filter((order) => order.status === "paid");
      const sales = paid.reduce((sum, order) => sum + Number(order.total), 0);
      const durations = paid.map((order) => {
        const end = order.ready_at ?? order.prepared_at;
        return end ? Math.max(0, (new Date(end).getTime() - new Date(order.placed_at).getTime()) / 60000) : null;
      }).filter((value): value is number => value !== null);
      const tableRows = tablesResult.data ?? [];
      let top: Summary["top"] = [];
      if (paid.length) {
        const { data: itemRows } = await db.from("order_items").select("name_ar,quantity,line_total").in("order_id", paid.map((order) => order.id));
        const totals = new Map<string, { quantity: number; sales: number }>();
        for (const item of itemRows ?? []) {
          const current = totals.get(item.name_ar) ?? { quantity: 0, sales: 0 };
          current.quantity += Number(item.quantity);
          current.sales += Number(item.line_total);
          totals.set(item.name_ar, current);
        }
        top = [...totals.entries()].map(([name, value]) => ({ name, ...value }))
          .sort((a, b) => b.quantity - a.quantity).slice(0, 5);
      }
      if (!active) return;
      setSummary({
        sales, orders: rows.length, pending: pendingResult.count ?? 0,
        openSessions: sessionsResult.count ?? 0, billRequests: billsResult.count ?? 0,
        avgPrep: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0,
        tables: {
          available: tableRows.filter((table) => table.status === "available").length,
          occupied: tableRows.filter((table) => table.status === "occupied").length,
          out: tableRows.filter((table) => table.status === "out_of_service").length,
        },
        top, recent: rows.slice(0, 8).map((order) => ({
          id: order.id, order_no: order.order_no, status: order.status,
          total: Number(order.total), placed_at: order.placed_at,
        })),
      });
    }
    void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "تعذر تحميل المؤشرات."));
    return () => { active = false; };
  }, [orderRevision, tableRevision, sessionRevision, billRevision]);

  const labels: Record<string, string> = {
    pending: "معلّق", approved: "معتمد", preparing: "قيد التحضير",
    ready: "جاهز", served: "تم التقديم", paid: "مدفوع", rejected: "مرفوض",
  };
  if (!summary) return <section className="admin-module"><div className="empty-state">{message || "جارٍ تحميل لوحة المؤشرات..."}</div></section>;

  return <section className="admin-module" dir="rtl">
    {message && <p className="feedback" role="alert">{message}</p>}
    <div className="admin-kpi-grid">
      <article><span>مبيعات اليوم</span><strong>{formatMoney(summary.sales)}</strong><small>الحسابات المدفوعة فقط</small></article>
      <article><span>طلبات اليوم</span><strong>{summary.orders}</strong><small>{summary.pending} بانتظار المراجعة</small></article>
      <article><span>متوسط زمن التجهيز</span><strong>{summary.avgPrep ? summary.avgPrep.toFixed(1) + " د" : "—"}</strong><small>حتى الجاهزية</small></article>
      <article><span>الطاولات المتاحة</span><strong>{summary.tables.available}</strong><small>{summary.tables.occupied} مشغولة · {summary.tables.out} خارج الخدمة</small></article>
      <article><span>الجلسات المفتوحة</span><strong>{summary.openSessions}</strong><small>طاولات قيد الخدمة حالياً</small></article>
      <article><span>طلبات الحساب</span><strong>{summary.billRequests}</strong><small>بانتظار متابعة النادل</small></article>
    </div>
    <div className="admin-overview-grid">
      <section className="admin-panel">
        <header><h2>آخر الطلبات</h2><span>اليوم</span></header>
        <div className="table-scroll"><table className="admin-table"><thead><tr><th>رقم الطلب</th><th>الحالة</th><th>الإجمالي</th><th>الوقت</th></tr></thead>
        <tbody>{summary.recent.map((order) => <tr key={order.id}><td>#{order.order_no}</td><td>{labels[order.status] ?? order.status}</td><td>{formatMoney(order.total)}</td><td>{new Date(order.placed_at).toLocaleTimeString("ar-SA")}</td></tr>)}</tbody></table></div>
        {!summary.recent.length && <p className="muted">لا توجد طلبات اليوم بعد.</p>}
      </section>
      <section className="admin-panel">
        <header><h2>الأكثر طلباً</h2><span>من الطلبات المدفوعة</span></header>
        {summary.top.map((item, index) => <div className="top-product" key={item.name}><b>{index + 1}</b><span>{item.name}</span><strong>{item.quantity}</strong><small>{formatMoney(item.sales)}</small></div>)}
        {!summary.top.length && <p className="muted">تظهر الأصناف بعد تسجيل مبيعات مدفوعة.</p>}
      </section>
    </div>
  </section>;
}
