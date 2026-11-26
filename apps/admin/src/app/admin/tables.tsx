"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { getSupabaseBrowserClient } from "@restaurant/db/client";
import { useRealtimeRefresh } from "@restaurant/realtime";

type TableRow = {
  id: string; number: number; seats: number; qr_token: string;
  status: "available" | "occupied" | "out_of_service";
};

export function TableManager() {
  const [rows, setRows] = useState<TableRow[]>([]);
  const [count, setCount] = useState("5");
  const [seats, setSeats] = useState("4");
  const [customerUrl, setCustomerUrl] = useState(process.env.NEXT_PUBLIC_CUSTOMER_APP_URL ?? "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const revision = useRealtimeRefresh("restaurant_tables");

  async function load() {
    const db = getSupabaseBrowserClient();
    const [tables, settings] = await Promise.all([
      db.from("restaurant_tables").select("id,number,seats,qr_token,status").order("number"),
      db.from("settings").select("customer_app_url").eq("id", 1).maybeSingle(),
    ]);
    if (tables.error) setMessage(tables.error.message);
    else setRows((tables.data ?? []) as TableRow[]);
    if (!settings.error && settings.data?.customer_app_url) setCustomerUrl(settings.data.customer_app_url);
  }
  useEffect(() => { void load(); }, [revision]);

  async function add() {
    const n = Number(count), s = Number(seats);
    if (!Number.isInteger(n) || n < 1 || n > 100 || !Number.isInteger(s) || s < 1 || s > 30) {
      setMessage("عدد الطاولات من 1 إلى 100 والمقاعد من 1 إلى 30.");
      return;
    }
    setBusy(true);
    const { error } = await getSupabaseBrowserClient().rpc("add_tables", { p_count: n, p_seats: s });
    setBusy(false);
    if (error) setMessage(error.message);
    else { setMessage("تمت إضافة الطاولات."); await load(); }
  }

  async function change(table: TableRow, status: "available" | "out_of_service") {
    const { error } = await getSupabaseBrowserClient().rpc("set_table_status", {
      p_table_id: table.id, p_status: status,
    });
    if (error) setMessage(error.message);
    else setRows((current) => current.map((item) => item.id === table.id ? { ...item, status } : item));
  }

  const baseUrl = (customerUrl || "http://localhost:3001").replace(/\/+$/, "");
  const available = rows.filter((table) => table.status === "available").length;
  const occupied = rows.filter((table) => table.status === "occupied").length;
  const out = rows.filter((table) => table.status === "out_of_service").length;

  return (
    <section className="admin-module" dir="rtl">
      <header className="module-heading">
        <div><span className="eyebrow">إدارة الصالة</span><h2>الطاولات والباركودات</h2><p>أضف طاولات بأرقام متسلسلة واطبع رمز كل طاولة لفتح تطبيق العميل.</p></div>
      </header>
      <div className="admin-kpi-grid table-kpis">
        <article><span>متاحة</span><strong>{available}</strong></article>
        <article><span>مشغولة</span><strong>{occupied}</strong></article>
        <article><span>خارج الخدمة</span><strong>{out}</strong></article>
      </div>
      <div className="table-tools">
        <label>عدد الطاولات <input value={count} onChange={(event) => setCount(event.target.value)} inputMode="numeric" /></label>
        <label>المقاعد الافتراضية <input value={seats} onChange={(event) => setSeats(event.target.value)} inputMode="numeric" /></label>
        <button className="action-button" disabled={busy} onClick={() => void add()}>{busy ? "جارٍ الإضافة..." : "إضافة طاولات"}</button>
        <button className="action-button secondary" onClick={() => window.print()}>طباعة الباركودات</button>
      </div>
      <p className="qr-destination" dir="ltr">QR destination: {baseUrl}</p>
      {!customerUrl && <p className="feedback">اضبط رابط تطبيق العميل من الإعدادات قبل طباعة QR للإنتاج.</p>}
      {message && <p className="feedback" role="status">{message}</p>}
      <div className="table-grid qr-print-grid">
        {rows.map((table) => (
          <article className="table-card qr-print-card" key={table.id}>
            <div><strong className="table-number-label"><span>رقم الطاولة</span>{table.number}</strong><p>{table.seats} مقاعد</p>
              <span className={"state-pill " + (table.status === "available" ? "active" : table.status === "occupied" ? "occupied" : "inactive")}>
                {table.status === "available" ? "متاحة" : table.status === "occupied" ? "مشغولة" : "خارج الخدمة"}
              </span>
            </div>
            <a href={baseUrl + "/t/" + table.number} target="_blank" rel="noreferrer" aria-label={"فتح QR طاولة " + table.number}>
              <QRCodeSVG value={baseUrl + "/t/" + table.number} size={112} />
            </a>
            <label>الحالة
              <select disabled={table.status === "occupied"} value={table.status}
                onChange={(event) => void change(table, event.target.value as "available" | "out_of_service")}>
                <option value="available">متاحة</option><option value="out_of_service">خارج الخدمة</option>
              </select>
            </label>
          </article>
        ))}
      </div>
      {!rows.length && <div className="empty-state">لا توجد طاولات بعد. أضف الطاولات للبدء.</div>}
    </section>
  );
}
