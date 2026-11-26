"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@restaurant/db/client";
import { formatMoney } from "@restaurant/i18n";

type Category = { id: string; name_ar: string; name_en: string | null; sort_order: number };
type Product = {
  id: string; category_id: string; name_ar: string; name_en: string | null;
  description_ar: string | null; price: number; image_path: string | null;
  is_available: boolean; is_featured: boolean; sort_order: number;
};
type Order = {
  id: string; order_no: number; status: string; subtotal: number; vat_amount: number;
  total: number; notes: string | null; placed_at: string;
};
type OrderItem = {
  id: string; order_id: string; name_ar: string; quantity: number;
  notes: string | null; line_total: number; station: string;
};
type CartLine = { quantity: number; notes: string };
type Quote = { subtotal: number; vat_amount: number; total: number };
type BillRequest = { id: string; status: "requested" | "acknowledged" | "closed" };

const statusSteps = [
  { key: "pending", label: "تم الإرسال" },
  { key: "approved", label: "تم الاعتماد" },
  { key: "preparing", label: "قيد التحضير" },
  { key: "ready", label: "جاهز" },
  { key: "served", label: "تم التقديم" },
];

function imageUrl(path: string | null) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return getSupabaseBrowserClient().storage.from("product-images").getPublicUrl(path).data.publicUrl;
}

export function CustomerOrder({ qr }: { qr: string }) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [tableNumber, setTableNumber] = useState<number | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<"open" | "closed">("open");
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [quote, setQuote] = useState<Quote | null>(null);
  const [activeCategory, setActiveCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"menu" | "cart" | "orders">("menu");
  const [billRequest, setBillRequest] = useState<BillRequest | null>(null);
  const [message, setMessage] = useState("جارٍ تجهيز طاولتك...");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const refreshSession = useCallback(async (id: string) => {
    const [orderResult, sessionResult, billResult] = await Promise.all([
      supabase.from("orders")
        .select("id,order_no,status,subtotal,vat_amount,total,notes,placed_at")
        .eq("session_id", id)
        .order("placed_at", { ascending: false }),
      supabase.from("table_sessions").select("status").eq("id", id).maybeSingle(),
      supabase.from("bill_requests").select("id,status").eq("session_id", id)
        .in("status", ["requested", "acknowledged", "closed"])
        .order("requested_at", { ascending: false }).limit(1).maybeSingle(),
    ]);

    if (orderResult.error) throw orderResult.error;
    const nextOrders = (orderResult.data ?? []) as Order[];
    setOrders(nextOrders);
    if (sessionResult.data?.status) setSessionStatus(sessionResult.data.status as "open" | "closed");
    setBillRequest((billResult.data ?? null) as BillRequest | null);

    if (nextOrders.length) {
      const itemsResult = await supabase.from("order_items")
        .select("id,order_id,name_ar,quantity,notes,line_total,station")
        .in("order_id", nextOrders.map((order) => order.id));
      if (!itemsResult.error) setOrderItems((itemsResult.data ?? []) as OrderItem[]);
    } else {
      setOrderItems([]);
    }
    setLastUpdated(new Date());
  }, [supabase]);

  useEffect(() => {
    let active = true;
    async function bootstrap() {
      setLoading(true);
      setMessage("جارٍ تجهيز طاولتك...");
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) {
        const { error: authError } = await supabase.auth.signInAnonymously();
        if (authError) throw new Error("تعذر بدء جلسة العميل. تأكد من تفعيل تسجيل الدخول المجهول في Supabase.");
      }

      const { data: resolved, error: resolveError } = await supabase.rpc("resolve_table", { p_qr: qr });
      if (resolveError || !resolved?.length) throw new Error("رمز الطاولة غير صحيح أو لم يعد متاحاً.");
      const table = resolved[0] as { table_number: number; status: string };
      if (table.status === "out_of_service") throw new Error("هذه الطاولة غير متاحة حالياً.");
      if (active) setTableNumber(table.table_number);

      const { data: joined, error: joinError } = await supabase.rpc("join_table_session", { p_qr: qr });
      if (joinError || !joined) throw new Error(joinError?.message ?? "تعذر فتح جلسة الطاولة.");
      const id = joined as string;
      if (!active) return;
      setSessionId(id);

      const [categoryResult, productResult] = await Promise.all([
        supabase.from("categories").select("id,name_ar,name_en,sort_order")
          .eq("is_active", true).order("sort_order"),
        supabase.from("products")
          .select("id,category_id,name_ar,name_en,description_ar,price,image_path,is_available,is_featured,sort_order")
          .eq("is_active", true).order("sort_order"),
      ]);
      if (categoryResult.error) throw categoryResult.error;
      if (productResult.error) throw productResult.error;
      if (active) {
        setCategories((categoryResult.data ?? []) as Category[]);
        setProducts((productResult.data ?? []) as Product[]);
        setMessage("");
      }
      await refreshSession(id);
    }

    void bootstrap().catch((error: unknown) => {
      if (active) setMessage(error instanceof Error ? error.message : "تعذر تحميل القائمة.");
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => { active = false; };
  }, [qr, refreshSession, supabase]);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    const refresh = () => {
      void refreshSession(sessionId).catch(() => {
        if (active) setMessage("لا يوجد اتصال، جارٍ إعادة المحاولة.");
      });
    };
    const channel = supabase.channel("customer-session-" + sessionId)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: "session_id=eq." + sessionId }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "bill_requests", filter: "session_id=eq." + sessionId }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "table_sessions", filter: "id=eq." + sessionId }, refresh)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") refresh();
      });
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [refreshSession, sessionId, supabase]);

  const cartItems = useMemo(() => Object.entries(cart).map(([product_id, line]) => ({
    product_id,
    quantity: line.quantity,
    notes: line.notes.trim() || null,
  })), [cart]);

  useEffect(() => {
    if (!sessionId || cartItems.length === 0 || sessionStatus === "closed") {
      setQuote(null);
      return;
    }
    let active = true;
    const timer = window.setTimeout(async () => {
      const { data, error } = await supabase.rpc("preview_order", {
        p_session_id: sessionId,
        p_items: cartItems,
      });
      if (!active) return;
      if (error) {
        setQuote(null);
        setMessage(error.message);
        return;
      }
      const row = Array.isArray(data) ? data[0] : data;
      setQuote(row ? {
        subtotal: Number(row.subtotal),
        vat_amount: Number(row.vat_amount),
        total: Number(row.total),
      } : null);
      setMessage("");
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [cartItems, sessionId, sessionStatus, supabase]);

  const filteredProducts = products.filter((product) => {
    const matchesCategory = activeCategory === "all" || product.category_id === activeCategory;
    const matchesSearch = !search.trim() ||
      product.name_ar.toLowerCase().includes(search.trim().toLowerCase()) ||
      (product.name_en ?? "").toLowerCase().includes(search.trim().toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const cartCount = Object.values(cart).reduce((sum, item) => sum + item.quantity, 0);
  const orderItemMap = useMemo(() => {
    const map = new Map<string, OrderItem[]>();
    for (const item of orderItems) map.set(item.order_id, [...(map.get(item.order_id) ?? []), item]);
    return map;
  }, [orderItems]);

  function changeQuantity(productId: string, amount: number) {
    setCart((current) => {
      const existing = current[productId];
      const quantity = (existing?.quantity ?? 0) + amount;
      if (quantity <= 0) {
        const next = { ...current };
        delete next[productId];
        return next;
      }
      if (quantity > 20) return current;
      return { ...current, [productId]: { quantity, notes: existing?.notes ?? "" } };
    });
  }

  function changeNotes(productId: string, notes: string) {
    setCart((current) => ({
      ...current,
      [productId]: { quantity: current[productId]?.quantity ?? 1, notes: notes.slice(0, 250) },
    }));
  }

  async function sendOrder() {
    if (!sessionId || !cartItems.length || !quote || busy || sessionStatus !== "open") return;
    setBusy(true);
    setMessage("");
    const { data, error } = await supabase.rpc("place_order", {
      p_session_id: sessionId,
      p_items: cartItems,
      p_notes: null,
    });
    setBusy(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    setCart({});
    setView("orders");
    setMessage(row?.order_no ? "تم إرسال طلبك رقم #" + row.order_no : "تم إرسال الطلب بنجاح.");
    await refreshSession(sessionId);
  }

  async function requestBill() {
    if (!sessionId || busy || sessionStatus === "closed") return;
    setBusy(true);
    const { error } = await supabase.rpc("request_bill", { p_session_id: sessionId });
    setBusy(false);
    if (error) setMessage(error.message);
    else {
      setMessage("تم طلب الحساب. النادل في الطريق إليك.");
      await refreshSession(sessionId);
    }
  }

  if (loading) {
    return <main className="customer-landing" dir="rtl"><span className="eyebrow">أهلاً بك</span><h1>نجهّز طاولتك</h1><p>يتم تحميل القائمة وربط جلستك...</p></main>;
  }

  if (!sessionId) {
    return <main className="customer-landing" dir="rtl"><span className="eyebrow">منصة الطلب</span><h1>تعذر فتح الطاولة</h1><p>{message}</p><button className="action-button" onClick={() => window.location.reload()}>إعادة المحاولة</button></main>;
  }

  return (
    <main className="customer-app" dir="rtl">
      <header className="customer-header">
        <div>
          <span className="eyebrow">أهلاً بك في مطعمنا</span>
          <h1>طاولة {tableNumber}</h1>
          <p>{sessionStatus === "closed" ? "شكراً لزيارتكم، نتمنى رؤيتكم قريباً." : "اختر أطباقك واستمتع بوقتك."}</p>
        </div>
        <span className={"connection-state " + (online ? "is-online" : "is-offline")}>
          {online ? "متصل" : "غير متصل"}
        </span>
      </header>

      {message && <p className="feedback" role="status">{message}</p>}
      {!online && <p className="offline-banner" role="status">لا يوجد اتصال، تظهر آخر حالة محفوظة وسيعاد الاتصال تلقائياً.</p>}

      {sessionStatus === "closed" ? (
        <section className="thanks-panel">
          <span aria-hidden="true">✦</span>
          <h2>شكراً لزيارتكم!</h2>
          <p>تم إغلاق الحساب وإتاحة الطاولة من جديد.</p>
          {orders.map((order) => <p key={order.id}>الطلب #{order.order_no} · {formatMoney(Number(order.total))}</p>)}
        </section>
      ) : (
        <>
          <nav className="customer-tabs" aria-label="القائمة الرئيسية">
            <button aria-pressed={view === "menu"} onClick={() => setView("menu")}>القائمة</button>
            <button aria-pressed={view === "cart"} onClick={() => setView("cart")}>السلة ({cartCount})</button>
            <button aria-pressed={view === "orders"} onClick={() => setView("orders")}>طلباتي ({orders.length})</button>
          </nav>

          {view === "menu" && (
            <section className="customer-menu">
              <input className="menu-search" type="search" placeholder="ابحث عن طبق..." value={search} onChange={(event) => setSearch(event.target.value)} />
              <div className="category-strip">
                <button className={activeCategory === "all" ? "selected" : ""} onClick={() => setActiveCategory("all")}>الكل</button>
                {categories.map((category) => (
                  <button className={activeCategory === category.id ? "selected" : ""} key={category.id} onClick={() => setActiveCategory(category.id)}>
                    {category.name_ar}
                  </button>
                ))}
              </div>
              <div className="menu-grid">
                {filteredProducts.map((product) => {
                  const img = imageUrl(product.image_path);
                  return (
                    <article className="product-card" key={product.id}>
                      {img ? <img className="product-image" src={img} alt={product.name_ar} loading="lazy" /> : <div className="product-art" aria-hidden="true">✦</div>}
                      <h2>{product.name_ar}</h2>
                      {product.description_ar && <p className="product-description">{product.description_ar}</p>}
                      <strong className="product-price">{formatMoney(Number(product.price))}</strong>
                      {product.is_available ? (
                        <button className="product-add" onClick={() => changeQuantity(product.id, 1)}>
                          {cart[product.id] ? "أضف المزيد · " + cart[product.id].quantity : "أضف إلى السلة"}
                        </button>
                      ) : <span className="unavailable-chip">غير متوفر حالياً</span>}
                    </article>
                  );
                })}
                {filteredProducts.length === 0 && <div className="empty-state">لا توجد أصناف تطابق بحثك.</div>}
              </div>
            </section>
          )}

          {view === "cart" && (
            <section className="cart-sheet">
              <div className="section-title"><h2>سلة طلبك</h2><span>{cartCount} أصناف</span></div>
              {cartItems.length === 0 ? <div className="empty-state"><p>السلة فارغة حالياً.</p><button className="action-button" onClick={() => setView("menu")}>تصفح القائمة</button></div> : (
                <>
                  <div className="cart-lines">
                    {cartItems.map((line) => {
                      const product = products.find((item) => item.id === line.product_id);
                      if (!product) return null;
                      return (
                        <article className="cart-line" key={line.product_id}>
                          <div className="cart-line-heading"><strong>{product.name_ar}</strong><span>{formatMoney(Number(product.price))}</span></div>
                          <div className="quantity-controls">
                            <button aria-label="زيادة الكمية" onClick={() => changeQuantity(line.product_id, 1)}>+</button>
                            <strong>{line.quantity}</strong>
                            <button aria-label="تقليل الكمية" onClick={() => changeQuantity(line.product_id, -1)}>−</button>
                          </div>
                          <label className="item-note">ملاحظة للصنف
                            <input value={line.notes ?? ""} onChange={(event) => changeNotes(line.product_id, event.target.value)} placeholder="بدون بصل، زيادة صوص..." maxLength={250} />
                          </label>
                        </article>
                      );
                    })}
                  </div>
                  <div className="quote-summary">
                    <div><span>المجموع قبل الضريبة</span><strong>{quote ? formatMoney(quote.subtotal) : "—"}</strong></div>
                    <div><span>ضريبة القيمة المضافة</span><strong>{quote ? formatMoney(quote.vat_amount) : "—"}</strong></div>
                    <div className="quote-total"><span>الإجمالي</span><strong>{quote ? formatMoney(quote.total) : "جارٍ التسعير..."}</strong></div>
                  </div>
                  <button className="action-button send-order" disabled={!quote || busy || !online} onClick={() => void sendOrder()}>
                    {busy ? "جارٍ الإرسال..." : "أرسل الطلب"}
                  </button>
                </>
              )}
            </section>
          )}

          {view === "orders" && (
            <section className="orders-list">
              <div className="section-title"><h2>طلبات الجلسة</h2>{lastUpdated && <small>آخر تحديث {lastUpdated.toLocaleTimeString("ar-SA")}</small>}</div>
              {orders.map((order) => {
                const currentIndex = statusSteps.findIndex((step) => step.key === order.status);
                const rejected = order.status === "rejected";
                return (
                  <article className="guest-order-card" key={order.id}>
                    <div className="guest-order-top">
                      <strong>#{order.order_no}</strong>
                      <span>{rejected ? "مرفوض" : statusSteps[Math.max(0, currentIndex)]?.label ?? order.status}</span>
                      <b>{formatMoney(Number(order.total))}</b>
                    </div>
                    {!rejected && <div className="order-stepper">{statusSteps.map((step, index) => <span className={(index <= currentIndex ? "done " : "") + "step"} key={step.key}>{step.label}</span>)}</div>}
                    <ul>{(orderItemMap.get(order.id) ?? []).map((item) => <li key={item.id}>{item.name_ar} × {item.quantity}{item.notes ? <small> — {item.notes}</small> : null}</li>)}</ul>
                    {order.rejected_reason && <p className="rejection-note">سبب الرفض: {order.rejected_reason}</p>}
                  </article>
                );
              })}
              {orders.length === 0 && <div className="empty-state"><p>لم ترسل أي طلب بعد.</p><button className="action-button" onClick={() => setView("menu")}>ابدأ طلبك</button></div>}
              {billRequest?.status === "requested" && <p className="bill-status">تم إرسال طلب الحساب. النادل في الطريق إليك.</p>}
              {billRequest?.status === "acknowledged" && <p className="bill-status">اطّلع النادل على طلب الحساب، وسيأتي إليك قريباً.</p>}
              <button className="bill-button" disabled={busy || !!billRequest || !online} onClick={() => void requestBill()}>
                {billRequest ? "تم طلب الحساب" : "اطلب النادل للدفع"}
              </button>
            </section>
          )}
        </>
      )}
    </main>
  );
}
