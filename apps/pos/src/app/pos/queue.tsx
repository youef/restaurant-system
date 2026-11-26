"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@restaurant/db/client";
import { useRealtimeRefresh } from "@restaurant/realtime";
import { formatMoney, formatDateTime } from "@restaurant/i18n";

type Order = { id: string; order_no: number; session_id: string; table_id: string; status: string; total: number; placed_at: string; notes: string | null };
type Item = { id: string; order_id: string; name_ar: string; quantity: number; notes: string | null };
type Table = { id: string; number: number };
type Session = { id: string; table_id: string; opened_at: string };
type Bill = { id: string; session_id: string; status: string; requested_at: string };

export function PosQueue() {
  const [view, setView] = useState<"orders" | "accounts">("orders");
  const [orders, setOrders] = useState<Order[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const orderRevision = useRealtimeRefresh("orders");
  const itemRevision = useRealtimeRefresh("order_items");
  const billRevision = useRealtimeRefresh("bill_requests");
  const sessionRevision = useRealtimeRefresh("table_sessions");

  async function loadOrders() {
    const db = getSupabaseBrowserClient();
    const { data, error } = await db.from("orders")
      .select("id,order_no,session_id,table_id,status,total,placed_at,notes")
      .eq("status", "pending")
      .order("placed_at", { ascending: true });
    if (error) { setMessage(error.message); return; }
    const rows = (data ?? []) as Order[];
    setOrders(rows);
    if (!rows.length) { setItems([]); return; }
    const ids = [...new Set(rows.map((order) => order.id))];
    const tableIds = [...new Set(rows.map((order) => order.table_id))];
    const [itemsResult, tablesResult] = await Promise.all([
      db.from("order_items").select("id,order_id,name_ar,quantity,notes").in("order_id", ids),
      db.from("restaurant_tables").select("id,number").in("id", tableIds),
    ]);
    if (itemsResult.error) setMessage(itemsResult.error.message);
    else setItems((itemsResult.data ?? []) as Item[]);
    if (!tablesResult.error) setTables((current) => {
      const byId = new Map(current.map((table) => [table.id, table]));
      for (const table of (tablesResult.data ?? []) as Table[]) byId.set(table.id, table);
      return [...byId.values()];
    });
  }

  async function loadAccounts() {
    const db = getSupabaseBrowserClient();
    const [sessionResult, billResult, tableResult] = await Promise.all([
      db.from("table_sessions").select("id,table_id,opened_at").eq("status", "open").order("opened_at"),
      db.from("bill_requests").select("id,session_id,status,requested_at").in("status", ["requested", "acknowledged"]).order("requested_at"),
      db.from("restaurant_tables").select("id,number"),
    ]);
    if (sessionResult.error) setMessage(sessionResult.error.message);
    else setSessions((sessionResult.data ?? []) as Session[]);
    if (billResult.error) setMessage(billResult.error.message);
    else setBills((billResult.data ?? []) as Bill[]);
    if (!tableResult.error) setTables((tableResult.data ?? []) as Table[]);
  }

  useEffect(() => { void loadOrders(); }, [orderRevision, itemRevision]);
  useEffect(() => { void loadAccounts(); }, [billRevision, sessionRevision, orderRevision]);

  const tableNumbers = useMemo(() => new Map(tables.map((table) => [table.id, table.number])), [tables]);
  const orderLines = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const item of items) map.set(item.order_id, [...(map.get(item.order_id) ?? []), item]);
    return map;
  }, [items]);
  const openBillSessions = new Set(bills.map((bill) => bill.session_id));

  async function advance(order: Order, status: "approved" | "rejected") {
    let reason: string | null = null;
    if (status === "rejected") {
      const options = "نفاد المنتج / خطأ في الطلب / الطاولة غير صحيحة";
      reason = window.prompt("اختر سبباً أو اكتب سبب الرفض:\n" + options);
      if (!reason?.trim()) return;
    }
    setBusyId(order.id);
    setMessage("");
    const { error } = await getSupabaseBrowserClient().rpc("advance_order", {
      p_order_id: order.id, p_to_status: status, p_reason: reason,
    });
    setBusyId(null);
    if (error) setMessage(error.message);
    else {
      setOrders((current) => current.filter((row) => row.id !== order.id));
      setItems((current) => current.filter((item) => item.order_id !== order.id));
    }
  }

  return (
    <section className="pos-workspace" dir="rtl">
      <nav className="pos-tabs">
        <button aria-pressed={view === "orders"} onClick={() => setView("orders")}>الطلبات المعلّقة ({orders.length})</button>
        <button aria-pressed={view === "accounts"} onClick={() => setView("accounts")}>الحسابات المفتوحة ({sessions.length})</button>
      </nav>
      {message && <p className="feedback" role="alert">{message}</p>}

      {view === "orders" ? (
        <div className="pos-order-grid">
          <section className="queue-panel">
            <div className="section-title"><h2>قائمة الانتظار</h2><span>{orders.length} طلب</span></div>
            {orders.map((order) => (
              <article className="pos-order-card" key={order.id}>
                <header>
                  <strong className="mono-number">#{order.order_no}</strong>
                  <span>طاولة {tableNumbers.get(order.table_id) ?? "—"}</span>
                  <small>{formatDateTime(order.placed_at)}</small>
                </header>
                <ul>
                  {(orderLines.get(order.id) ?? []).map((item) => (
                    <li key={item.id}>{item.name_ar} × {item.quantity}{item.notes ? <small> · {item.notes}</small> : null}</li>
                  ))}
                </ul>
                {order.notes && <p className="order-note">ملاحظة الطلب: {order.notes}</p>}
                <footer>
                  <b>{formatMoney(Number(order.total))}</b>
                  <div className="record-actions">
                    <button className="action-button" disabled={busyId === order.id} onClick={() => void advance(order, "approved")}>موافقة</button>
                    <button className="action-button danger" disabled={busyId === order.id} onClick={() => void advance(order, "rejected")}>رفض</button>
                  </div>
                </footer>
              </article>
            ))}
            {!orders.length && <div className="empty-state"><h3>لا توجد طلبات معلّقة</h3><p>الطلبات الجديدة ستظهر هنا تلقائياً.</p></div>}
          </section>
          <aside className="pos-side-panel">
            <h2>مؤشرات اليوم</h2>
            <div className="pos-quick-stat"><span>طلبات تنتظر المراجعة</span><strong>{orders.length}</strong></div>
            <div className="pos-quick-stat"><span>جلسات بطلب حساب</span><strong>{bills.length}</strong></div>
            <p>الموافقة تنقل الطلب إلى المطبخ، والرفض يتطلب سبباً واضحاً يسجل في قاعدة البيانات.</p>
          </aside>
        </div>
      ) : (
        <section className="queue-panel">
          <div className="section-title"><h2>الجلسات المفتوحة</h2><span>{sessions.length} طاولة</span></div>
          {sessions.map((session) => (
            <SessionAccount
              key={session.id}
              session={session}
              tableNumber={tableNumbers.get(session.table_id) ?? 0}
              bill={bills.find((item) => item.session_id === session.id) ?? null}
            />
          ))}
          {!sessions.length && <div className="empty-state">لا توجد حسابات مفتوحة حالياً.</div>}
        </section>
      )}
    </section>
  );
}

function SessionAccount({ session, tableNumber, bill }: { session: Session; tableNumber: number; bill: Bill | null }) {
  const [total, setTotal] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    getSupabaseBrowserClient().from("orders").select("total").eq("session_id", session.id)
      .not("status", "in", "(rejected,paid)")
      .then(({ data, error }) => {
        if (active && !error) setTotal((data ?? []).reduce((sum, row) => sum + Number(row.total), 0));
      });
    return () => { active = false; };
  }, [session.id]);
  return (
    <article className="session-account">
      <div>
        <strong>طاولة {tableNumber}</strong>
        <p>بدأت {formatDateTime(session.opened_at)}</p>
        {bill && <span className="bill-chip">{bill.status === "requested" ? "طلب حساب جديد" : "النادل اطّلع على الحساب"}</span>}
      </div>
      <strong>{total === null ? "—" : formatMoney(total)}</strong>
    </article>
  );
}
