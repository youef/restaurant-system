"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@restaurant/db/client";
import { useRealtimeRefresh } from "@restaurant/realtime";

type Order = { id: string; order_no: number; table_id: string; status: string; placed_at: string };
type Item = { id: string; order_id: string; name_ar: string; quantity: number; notes: string | null; station: string };
type Table = { id: string; number: number };
type Station = "all" | "kitchen" | "grill" | "bar" | "dessert";

const stations: { id: Station; label: string }[] = [
  { id: "all", label: "الكل" }, { id: "kitchen", label: "المطبخ" },
  { id: "grill", label: "الشواية" }, { id: "bar", label: "البار" },
  { id: "dessert", label: "الحلويات" },
];

export function KdsBoard() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [station, setStation] = useState<Station>("all");
  const [message, setMessage] = useState("");
  const [clock, setClock] = useState(Date.now());
  const revision = useRealtimeRefresh("orders");
  const itemRevision = useRealtimeRefresh("order_items");

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      const db = getSupabaseBrowserClient();
      const { data, error } = await db.from("orders")
        .select("id,order_no,table_id,status,placed_at")
        .in("status", ["approved", "preparing", "ready"])
        .order("placed_at", { ascending: true });
      if (error) { setMessage(error.message); return; }
      const rows = (data ?? []) as Order[];
      if (!active) return;
      setOrders(rows);
      if (!rows.length) { setItems([]); return; }
      const ids = rows.map((order) => order.id);
      const tableIds = [...new Set(rows.map((order) => order.table_id))];
      const [lineResult, tableResult] = await Promise.all([
        db.from("order_items").select("id,order_id,name_ar,quantity,notes,station").in("order_id", ids),
        db.from("restaurant_tables").select("id,number").in("id", tableIds),
      ]);
      if (!active) return;
      if (lineResult.error) setMessage(lineResult.error.message);
      else setItems((lineResult.data ?? []) as Item[]);
      if (!tableResult.error) setTables((tableResult.data ?? []) as Table[]);
    }
    void load();
    return () => { active = false; };
  }, [revision, itemRevision]);

  const tableNumbers = useMemo(() => new Map(tables.map((table) => [table.id, table.number])), [tables]);
  const groupedItems = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const item of items) map.set(item.order_id, [...(map.get(item.order_id) ?? []), item]);
    return map;
  }, [items]);

  async function move(order: Order, to: "preparing" | "ready") {
    setMessage("");
    const { error } = await getSupabaseBrowserClient().rpc("advance_order", {
      p_order_id: order.id, p_to_status: to, p_reason: null,
    });
    if (error) setMessage(error.message);
    else setOrders((current) => current.map((item) => item.id === order.id ? { ...item, status: to } : item));
  }

  function visibleLines(orderId: string) {
    const lines = groupedItems.get(orderId) ?? [];
    return station === "all" ? lines : lines.filter((item) => item.station === station);
  }

  const columns = [
    { status: "approved", title: "جديد", next: "preparing" as const },
    { status: "preparing", title: "قيد التحضير", next: "ready" as const },
    { status: "ready", title: "جاهز للتقديم", next: null },
  ];

  return (
    <section className="kds-board" dir="rtl">
      <nav className="kds-stations" aria-label="محطات التحضير">
        {stations.map((item) => <button key={item.id} aria-pressed={station === item.id} onClick={() => setStation(item.id)}>{item.label}</button>)}
      </nav>
      {message && <p role="alert" className="feedback">{message}</p>}
      <div className="kds-columns">
        {columns.map((column) => {
          const rows = orders.filter((order) => order.status === column.status && visibleLines(order.id).length > 0);
          return (
            <section className="kds-column" key={column.status}>
              <header><h2>{column.title}</h2><strong>{rows.length}</strong></header>
              {rows.map((order) => {
                const age = Math.max(0, Math.floor((clock - new Date(order.placed_at).getTime()) / 60000));
                const ageClass = age >= 15 ? "urgent" : age >= 10 ? "late" : age >= 5 ? "warning" : "fresh";
                return (
                  <article className={"kds-ticket " + ageClass} key={order.id}>
                    <header><strong className="ticket-number">#{order.order_no}</strong><span>طاولة {tableNumbers.get(order.table_id) ?? "—"}</span><b>{age} د</b></header>
                    <ul>{visibleLines(order.id).map((item) => (
                      <li key={item.id}><strong>{item.quantity}×</strong> {item.name_ar}{item.notes && <small>{item.notes}</small>}</li>
                    ))}</ul>
                    {column.next && <button className="kds-action" onClick={() => void move(order, column.next)}>{column.next === "preparing" ? "ابدأ التحضير" : "علّم الطلب جاهزاً"}</button>}
                    {!column.next && <span className="ready-label">جاهز لاستلام النادل</span>}
                  </article>
                );
              })}
              {!rows.length && <p className="kds-empty">لا توجد تذاكر في هذه المرحلة.</p>}
            </section>
          );
        })}
      </div>
    </section>
  );
}
