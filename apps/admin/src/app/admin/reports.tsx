"use client";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@restaurant/db/client";
import { formatMoney } from "@restaurant/i18n";

type PaidOrder = { id: string; order_no: number; subtotal: number; vat_amount: number; total: number; paid_at: string; placed_at: string };
type Day = { key: string; count: number; sales: number; vat: number };

export function AdminReports() {
  const [period, setPeriod] = useState("30");
  const [orders, setOrders] = useState<PaidOrder[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      const from = new Date();
      from.setDate(from.getDate() - Number(period));
      const { data, error } = await getSupabaseBrowserClient().from("orders")
        .select("id,order_no,subtotal,vat_amount,total,paid_at,placed_at")
        .eq("status", "paid").gte("paid_at", from.toISOString())
        .order("paid_at", { ascending: false }).limit(5000);
      if (!active) return;
      setLoading(false);
      if (error) setMessage(error.message);
      else { setOrders((data ?? []) as PaidOrder[]); setMessage(""); }
    }
    void load();
    return () => { active = false; };
  }, [period]);
  const grouped = new Map<string, Day>();
  for (const order of orders) {
    const date = new Date(order.paid_at).toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
    const current = grouped.get(date) ?? { key: date, count: 0, sales: 0, vat: 0 };
    current.count += 1; current.sales += Number(order.total); current.vat += Number(order.vat_amount);
    grouped.set(date, current);
  }
  const series = [...grouped.values()].sort((a,b) => a.key.localeCompare(b.key));
  const totals = orders.reduce((sum, order) => ({
    sales: sum.sales + Number(order.total), vat: sum.vat + Number(order.vat_amount),
    beforeVat: sum.beforeVat + Number(order.subtotal),
  }), { sales: 0, vat: 0, beforeVat: 0 });
  const maxSales = Math.max(1, ...series.map((day) => day.sales));
  function exportCsv() {
    const rows = [["رقم الطلب","تاريخ الدفع","قبل الضريبة","الضريبة","الإجمالي"],
      ...orders.map((order) => [String(order.order_no),new Date(order.paid_at).toLocaleString("ar-SA"),
        Number(order.subtotal).toFixed(2),Number(order.vat_amount).toFixed(2),Number(order.total).toFixed(2)])];
    const csv = "\uFEFF" + rows.map((row) => row.map((value) => '"' + value.replace(/"/g,'""') + '"').join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "restaurant-sales.csv"; anchor.click();
    URL.revokeObjectURL(url);
  }
  return <section className="admin-module" dir="rtl">
    <header className="module-heading"><div><span className="eyebrow">المبيعات</span><h2>تقارير المبيعات</h2><p>الحسابات المدفوعة والمغلقة.</p></div>
      <div className="report-controls"><select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="7">آخر 7 أيام</option><option value="30">آخر 30 يوماً</option><option value="90">آخر 90 يوماً</option></select><button className="action-button" onClick={exportCsv} disabled={!orders.length}>تصدير CSV</button></div>
    </header>
    {message && <p className="feedback" role="alert">{message}</p>}
    <div className="admin-kpi-grid report-kpis">
      <article><span>إجمالي المبيعات</span><strong>{formatMoney(totals.sales)}</strong></article>
      <article><span>قبل الضريبة</span><strong>{formatMoney(totals.beforeVat)}</strong></article>
      <article><span>ضريبة VAT</span><strong>{formatMoney(totals.vat)}</strong></article>
      <article><span>عدد الحسابات</span><strong>{orders.length}</strong></article>
    </div>
    <section className="admin-panel"><header><h3>المبيعات حسب اليوم</h3><span>{loading ? "جارٍ التحميل..." : series.length + " يوم"}</span></header>
      <div className="sales-bars">{series.map((day) => <div className="sales-bar-row" key={day.key}>
        <time>{day.key}</time><div className="sales-bar-track"><i style={{ width: ((day.sales/maxSales)*100).toFixed(1) + "%" }} /></div><strong>{formatMoney(day.sales)}</strong><small>{day.count} حساب</small>
      </div>)}{!series.length && <p className="muted">لا توجد مبيعات مدفوعة خلال هذه الفترة.</p>}</div>
    </section>
    <section className="admin-panel"><header><h3>تفاصيل الحسابات</h3><span>الأحدث أولاً</span></header>
      <div className="table-scroll"><table className="admin-table"><thead><tr><th>الطلب</th><th>تاريخ الدفع</th><th>قبل الضريبة</th><th>الضريبة</th><th>الإجمالي</th></tr></thead>
        <tbody>{orders.map((order) => <tr key={order.id}><td>#{order.order_no}</td><td>{new Date(order.paid_at).toLocaleString("ar-SA")}</td><td>{formatMoney(Number(order.subtotal))}</td><td>{formatMoney(Number(order.vat_amount))}</td><td>{formatMoney(Number(order.total))}</td></tr>)}</tbody>
      </table></div>
    </section>
  </section>;
}
