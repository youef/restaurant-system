"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@restaurant/db/client";
import { useRealtimeRefresh } from "@restaurant/realtime";
import { formatMoney, formatDateTime } from "@restaurant/i18n";

type Table = { id: string; number: number; seats: number; status: string };
type Session = { id: string; table_id: string; opened_at: string };
type Order = { id: string; order_no: number; table_id: string; session_id: string; status: string; total: number; placed_at: string };
type Bill = { id: string; session_id: string; status: string; requested_at: string };
type Item = { id: string; order_id: string; name_ar: string; quantity: number };

export function WaiterBoard() {
  const [view, setView] = useState<"tasks" | "tables">("tasks");
  const [tables, setTables] = useState<Table[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const [method, setMethod] = useState<"cash" | "card">("cash");
  const [received, setReceived] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const orderRevision = useRealtimeRefresh("orders");
  const billRevision = useRealtimeRefresh("bill_requests");
  const tableRevision = useRealtimeRefresh("restaurant_tables");
  const sessionRevision = useRealtimeRefresh("table_sessions");

  useEffect(() => {
    let active = true;
    async function load() {
      const db = getSupabaseBrowserClient();
      const [tableResult, sessionResult, orderResult, billResult] = await Promise.all([
        db.from("restaurant_tables").select("id,number,seats,status").order("number"),
        db.from("table_sessions").select("id,table_id,opened_at").eq("status", "open"),
        db.from("orders").select("id,order_no,table_id,session_id,status,total,placed_at").neq("status", "paid"),
        db.from("bill_requests").select("id,session_id,status,requested_at")
          .in("status", ["requested", "acknowledged"]).order("requested_at"),
      ]);
      if (!active) return;
      if (tableResult.error) setMessage(tableResult.error.message); else setTables((tableResult.data ?? []) as Table[]);
      if (sessionResult.error) setMessage(sessionResult.error.message); else setSessions((sessionResult.data ?? []) as Session[]);
      if (orderResult.error) setMessage(orderResult.error.message); else setOrders((orderResult.data ?? []) as Order[]);
      if (billResult.error) setMessage(billResult.error.message); else setBills((billResult.data ?? []) as Bill[]);
      const ids = (orderResult.data ?? []).map((order) => order.id);
      if (ids.length) {
        const { data, error } = await db.from("order_items").select("id,order_id,name_ar,quantity").in("order_id", ids);
        if (active) { if (error) setMessage(error.message); else setItems((data ?? []) as Item[]); }
      } else if (active) setItems([]);
    }
    void load();
    return () => { active = false; };
  }, [orderRevision, billRevision, tableRevision, sessionRevision]);

  const tableNumbers = useMemo(() => new Map(tables.map((table) => [table.id, table.number])), [tables]);
  const sessionTable = useMemo(() => new Map(sessions.map((session) => [session.id, tableNumbers.get(session.table_id) ?? 0])), [sessions, tableNumbers]);
  const billSessions = new Set(bills.map((bill) => bill.session_id));
  const selectedOrders = selectedBill ? orders.filter((order) => order.session_id === selectedBill.session_id) : [];
  const billTotal = selectedOrders.filter((order) => order.status !== "rejected").reduce((sum, order) => sum + Number(order.total), 0);
  const canClose = selectedOrders.every((order) => order.status === "served" || order.status === "rejected");
  const changeDue = Math.max(0, Number(received || 0) - billTotal);

  async function markServed(order: Order) {
    setBusy(true);
    const { error } = await getSupabaseBrowserClient().rpc("advance_order", {
      p_order_id: order.id, p_to_status: "served", p_reason: null,
    });
    setBusy(false);
    if (error) setMessage(error.message);
    else setOrders((current) => current.map((item) => item.id === order.id ? { ...item, status: "served" } : item));
  }

  async function acknowledge(bill: Bill) {
    setBusy(true);
    const { error } = await getSupabaseBrowserClient().rpc("acknowledge_bill", { p_request_id: bill.id });
    setBusy(false);
    if (error) setMessage(error.message);
    else setBills((current) => current.map((item) => item.id === bill.id ? { ...item, status: "acknowledged" } : item));
  }

  async function closePayment() {
    if (!selectedBill || busy) return;
    if (!canClose) { setMessage("لا يمكن إغلاق الحساب قبل تقديم أو رفض جميع الطلبات."); return; }
    if (method === "cash" && Number(received) < billTotal) {
      setMessage("المبلغ المستلم أقل من إجمالي الحساب.");
      return;
    }
    setBusy(true);
    const { error } = await getSupabaseBrowserClient().rpc("close_session", {
      p_session_id: selectedBill.session_id,
      p_method: method,
    });
    setBusy(false);
    if (error) setMessage(error.message);
    else {
      setMessage("تم استلام الدفع وإغلاق الحساب بنجاح.");
      setSelectedBill(null);
      setReceived("");
      setBills((current) => current.filter((bill) => bill.session_id !== selectedBill.session_id));
      setSessions((current) => current.filter((session) => session.id !== selectedBill.session_id));
    }
  }

  return (
    <section className="waiter-app" dir="rtl">
      <nav className="waiter-tabs">
        <button aria-pressed={view === "tasks"} onClick={() => setView("tasks")}>المهام ({bills.length + orders.filter((order) => order.status === "ready").length})</button>
        <button aria-pressed={view === "tables"} onClick={() => setView("tables")}>الطاولات ({sessions.length})</button>
      </nav>
      {message && <p className="feedback" role="status">{message}</p>}
      {view === "tasks" ? (
        <div className="waiter-task-list">
          <section className="queue-panel">
            <div className="section-title"><h2>طلبات الحساب</h2><span>{bills.length}</span></div>
            {bills.map((bill) => (
              <article className="waiter-task-card bill-task" key={bill.id}>
                <div><strong>طاولة {sessionTable.get(bill.session_id) ?? "—"}</strong><p>{bill.status === "requested" ? "طلب جديد" : "تم الاطلاع على الحساب"}</p><small>{formatDateTime(bill.requested_at)}</small></div>
                <div className="record-actions">
                  {bill.status === "requested" && <button className="action-button secondary" disabled={busy} onClick={() => void acknowledge(bill)}>استلام</button>}
                  <button className="action-button" onClick={() => { setSelectedBill(bill); setMethod("cash"); setReceived(""); }}>استلام الدفع</button>
                </div>
              </article>
            ))}
            {!bills.length && <div className="empty-state">لا توجد طلبات حساب الآن.</div>}
          </section>
          <section className="queue-panel">
            <div className="section-title"><h2>جاهز للتقديم</h2><span>{orders.filter((order) => order.status === "ready").length}</span></div>
            {orders.filter((order) => order.status === "ready").map((order) => (
              <article className="waiter-task-card" key={order.id}>
                <div><strong>طلب #{order.order_no} · طاولة {tableNumbers.get(order.table_id) ?? "—"}</strong><p>{formatMoney(Number(order.total))}</p>
                  <ul>{items.filter((item) => item.order_id === order.id).map((item) => <li key={item.id}>{item.name_ar} × {item.quantity}</li>)}</ul>
                </div>
                <button className="action-button" disabled={busy} onClick={() => void markServed(order)}>تم التقديم</button>
              </article>
            ))}
            {!orders.some((order) => order.status === "ready") && <div className="empty-state">لا توجد طلبات جاهزة للتقديم.</div>}
          </section>
        </div>
      ) : (
        <div className="waiter-table-grid">
          {tables.map((table) => {
            const session = sessions.find((row) => row.table_id === table.id);
            const hasBill = session ? billSessions.has(session.id) : false;
            return (
              <article className={"waiter-table-card table-" + table.status} key={table.id}>
                <strong>طاولة {table.number}</strong><span>{table.seats} مقاعد</span>
                <b>{table.status === "available" ? "متاحة" : table.status === "occupied" ? "مشغولة" : "خارج الخدمة"}</b>
                {hasBill && <span className="bill-chip">طلب حساب</span>}
                {session && <small>بدأت {formatDateTime(session.opened_at)}</small>}
              </article>
            );
          })}
        </div>
      )}

      {selectedBill && (
        <div className="sheet-backdrop" role="presentation" onClick={() => setSelectedBill(null)}>
          <section className="payment-sheet" role="dialog" aria-modal="true" aria-label="إغلاق الحساب" onClick={(event) => event.stopPropagation()}>
            <header><span className="eyebrow">استلام الدفع</span><button className="close-button" onClick={() => setSelectedBill(null)}>إغلاق</button></header>
            <h2>طاولة {sessionTable.get(selectedBill.session_id) ?? "—"}</h2>
            <div className="payment-total"><span>المبلغ المطلوب</span><strong>{formatMoney(billTotal)}</strong></div>
            {!canClose && <p className="feedback">يجب تقديم الطلبات الجاهزة أولاً قبل إغلاق الحساب.</p>}
            <div className="payment-methods">
              <button aria-pressed={method === "cash"} onClick={() => setMethod("cash")}>نقد</button>
              <button aria-pressed={method === "card"} onClick={() => setMethod("card")}>شبكة</button>
            </div>
            {method === "cash" && (
              <>
                <label>المبلغ المستلم
                  <input type="number" min={billTotal} step="0.01" value={received} onChange={(event) => setReceived(event.target.value)} inputMode="decimal" />
                </label>
                <div className="payment-change"><span>الباقي للعميل</span><strong>{formatMoney(changeDue)}</strong></div>
              </>
            )}
            <button className="action-button payment-confirm" disabled={busy || !canClose || (method === "cash" && Number(received) < billTotal)} onClick={() => void closePayment()}>
              {busy ? "جارٍ الإغلاق..." : "تأكيد الدفع وإغلاق الحساب"}
            </button>
          </section>
        </div>
      )}
    </section>
  );
}
