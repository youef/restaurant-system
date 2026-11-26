"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@restaurant/db/client";
import { formatMoney } from "@restaurant/i18n";
import { Search, ShoppingBag, ClipboardList, UtensilsCrossed, Plus, Minus, X, WifiOff, ArrowLeft, Check, Store, MapPin, Phone, Clock, LayoutGrid, List, Sparkles, ChefHat, Flame, Banknote, CreditCard, RefreshCw, ChevronDown, ChevronUp, RotateCcw, CalendarDays, ReceiptText, CircleCheck, Timer, AlertCircle, Bell, BellRing, ShieldCheck } from "lucide-react";

type Category = { id: string; name_ar: string; name_en: string | null; sort_order: number };
type RestaurantSettings = { restaurant_name_ar: string; restaurant_name_en: string | null; logo_path: string | null; phone: string | null; address: string | null; opening_hours: Record<string, unknown> | null };
type Product = {
  id: string; category_id: string; name_ar: string; name_en: string | null;
  description_ar: string | null; price: number; image_path: string | null;
  is_available: boolean; is_featured: boolean; sort_order: number; station: string | null;
};
type Order = {
  id: string; order_no: number; status: string; subtotal: number; vat_amount: number;
  total: number; notes: string | null; rejected_reason: string | null; placed_at: string; payment_method: "cash" | "card";
};
type OrderItem = {
  id: string; order_id: string; product_id: string; name_ar: string; unit_price: number; quantity: number;
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

function phoneToE164(value: string) {
  const digits = value.replace(/\D/g, "");
  if (/^05[0-9]{8}$/.test(digits)) return "+966" + digits.slice(1);
  if (/^9665[0-9]{8}$/.test(digits)) return "+" + digits;
  if (/^5[0-9]{8}$/.test(digits)) return "+966" + digits;
  return null;
}
function base64UrlToUint8Array(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}
export function CustomerOrder({ qr }: { qr: string }) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [tableNumber, setTableNumber] = useState<number | null>(null);
  const [phone, setPhone] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("default");
  const [notificationsBusy, setNotificationsBusy] = useState(false);
  const [pushReady, setPushReady] = useState(false);
  const previousOrderStatuses = useRef<Record<string, string>>({});
  const audioContextRef = useRef<AudioContext | null>(null);
  const [restaurant, setRestaurant] = useState<RestaurantSettings | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<"open" | "closed">("open");
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [quote, setQuote] = useState<Quote | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card">("cash");
  const [orderFilter, setOrderFilter] = useState<"all" | "active" | "completed" | "rejected">("all");
  const [expandedOrders, setExpandedOrders] = useState<string[]>([]);
  const [refreshingOrders, setRefreshingOrders] = useState(false);
  const [activeCategory, setActiveCategory] = useState("all");
  const [productLayout, setProductLayout] = useState<"grid" | "list">("grid");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"menu" | "cart" | "orders">("menu");
  const [billRequest, setBillRequest] = useState<BillRequest | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);

  const refreshSession = useCallback(async (id: string) => {
    const [orderResult, sessionResult, billResult] = await Promise.all([
      supabase.from("orders")
        .select("id,order_no,status,subtotal,vat_amount,total,notes,rejected_reason,placed_at,payment_method")
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
        .select("id,order_id,product_id,name_ar,unit_price,quantity,notes,line_total,station")
        .in("order_id", nextOrders.map((order) => order.id));
      if (!itemsResult.error) setOrderItems((itemsResult.data ?? []) as OrderItem[]);
    } else {
      setOrderItems([]);
    }
  }, [supabase]);

  useEffect(() => {
    const savedPhone = window.sessionStorage.getItem("customer-visit-phone");
    if (savedPhone) {
      setPhone(savedPhone);
      setPhoneInput(savedPhone);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setNotificationPermission("unsupported");
      return;
    }
    setNotificationPermission(Notification.permission);
  }, []);

  useEffect(() => {
    let active = true;
    async function bootstrap() {
      if (!phone) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setMessage("جارٍ تجهيز طاولتك...");
      const { data: authData } = await supabase.auth.getUser();
      let guestUser = authData.user;
      if (!guestUser) {
        const { data: signInData, error: authError } = await supabase.auth.signInAnonymously();
        if (authError) throw new Error("تعذر بدء جلسة العميل. تأكد من تفعيل تسجيل الدخول المجهول في Supabase.");
        guestUser = signInData.user;
      }
      if (!guestUser) throw new Error("تعذر إنشاء جلسة العميل.");
      const { error: contactError } = await supabase.from("customer_contacts").upsert({
        user_id: guestUser.id,
        phone_e164: phoneToE164(phone),
      }, { onConflict: "user_id" });
      if (contactError) throw new Error("تعذر حفظ رقم الجوال بشكل آمن: " + contactError.message);

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

      const [categoryResult, productResult, settingsResult] = await Promise.all([
        supabase.from("categories").select("id,name_ar,name_en,sort_order")
          .eq("is_active", true).order("sort_order"),
        supabase.from("products")
          .select("id,category_id,name_ar,name_en,description_ar,price,image_path,is_available,is_featured,sort_order,station")
          .eq("is_active", true).order("sort_order"),
        supabase.from("settings").select("restaurant_name_ar,restaurant_name_en,logo_path,phone,address,opening_hours").eq("id", 1).maybeSingle(),
      ]);
      if (categoryResult.error) throw categoryResult.error;
      if (productResult.error) throw productResult.error;
      if (active) {
        setCategories((categoryResult.data ?? []) as Category[]);
        setProducts((productResult.data ?? []) as Product[]);
        setRestaurant((settingsResult.data ?? null) as RestaurantSettings | null);
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
  }, [phone, qr, refreshSession, supabase]);

  useEffect(() => {
    const saved = window.localStorage.getItem("customer-product-layout");
    if (saved === "grid" || saved === "list") setProductLayout(saved);
  }, []);

  function changeProductLayout(layout: "grid" | "list") {
    setProductLayout(layout);
    window.localStorage.setItem("customer-product-layout", layout);
  }

  useEffect(() => {
    // Disable pinch/double-tap zoom, selection, clipboard actions and native context menus.
    const prevent = (event: Event) => event.preventDefault();
    const preventClipboard = (event: ClipboardEvent) => event.preventDefault();
    const preventZoomKeys = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && ["+", "=", "-", "0", "c", "x", "v"].includes(key)) event.preventDefault();
    };
    document.addEventListener("contextmenu", prevent, true);
    document.addEventListener("selectstart", prevent, true);
    document.addEventListener("dragstart", prevent, true);
    document.addEventListener("copy", preventClipboard, true);
    document.addEventListener("cut", preventClipboard, true);
    document.addEventListener("paste", preventClipboard, true);
    document.addEventListener("keydown", preventZoomKeys, true);
    document.addEventListener("gesturestart", prevent, { capture: true, passive: false });
    document.addEventListener("gesturechange", prevent, { capture: true, passive: false });
    document.addEventListener("gestureend", prevent, { capture: true, passive: false });
    return () => {
      document.removeEventListener("contextmenu", prevent, true);
      document.removeEventListener("selectstart", prevent, true);
      document.removeEventListener("dragstart", prevent, true);
      document.removeEventListener("copy", preventClipboard, true);
      document.removeEventListener("cut", preventClipboard, true);
      document.removeEventListener("paste", preventClipboard, true);
      document.removeEventListener("keydown", preventZoomKeys, true);
      document.removeEventListener("gesturestart", prevent, true);
      document.removeEventListener("gesturechange", prevent, true);
      document.removeEventListener("gestureend", prevent, true);
    };
  }, []);

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
    if (!orders.length) return;
    const nextStatuses: Record<string, string> = {};
    const changed = orders.filter((order) => {
      nextStatuses[order.id] = order.status;
      const previous = previousOrderStatuses.current[order.id];
      return Boolean(previous && previous !== order.status);
    });
    previousOrderStatuses.current = nextStatuses;
    if (!changed.length) return;
    const latest = changed[0];
    const statusLabel = ({
      pending: "تم استلام الطلب",
      approved: "تم اعتماد الطلب",
      preparing: "طلبك قيد التحضير",
      ready: "طلبك جاهز للاستلام",
      served: "تم تقديم طلبك",
      paid: "تم إغلاق الحساب",
      rejected: "تعذر تنفيذ الطلب",
    } as Record<string, string>)[latest.status] ?? "تحديث جديد على طلبك";
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      void navigator.serviceWorker.ready.then((registration) =>
        registration.showNotification("تحديث الطلب #" + latest.order_no, {
          body: statusLabel,
          icon: "/icon.svg",
          badge: "/icon.svg",
          tag: "order-" + latest.id,
          silent: false,
        })
      ).catch(() => undefined);
    }
    const context = audioContextRef.current;
    if (context && context.state === "running") {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, context.currentTime);
      oscillator.frequency.setValueAtTime(660, context.currentTime + 0.16);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.42);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.44);
    }
  }, [orders]);

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

  async function enableNotifications() {
    if (notificationsBusy) return;
    if (typeof window === "undefined" || !("Notification" in window)) {
      setNotificationPermission("unsupported");
      setMessage("هذا المتصفح لا يدعم إشعارات الويب. استخدم متصفحاً حديثاً.");
      return;
    }
    setNotificationsBusy(true);
    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      if ("AudioContext" in window) {
        const context = new AudioContext();
        await context.resume();
        audioContextRef.current = context;
      }
      if (permission !== "granted") {
        setMessage(permission === "denied"
          ? "تم رفض الإشعارات. فعّلها من إعدادات الموقع في المتصفح ثم أعد المحاولة."
          : "نحتاج السماح بالإشعارات حتى نرسل لك تحديثات الطلب.");
        return;
      }
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (publicKey && sessionId) {
        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: base64UrlToUint8Array(publicKey),
          });
        }
        const json = subscription.toJSON();
        const { data: authData } = await supabase.auth.getUser();
        if (!authData.user || !json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
          throw new Error("تعذر حفظ اشتراك الإشعارات.");
        }
        const { error } = await supabase.from("customer_push_subscriptions").upsert({
          endpoint: json.endpoint,
          user_id: authData.user.id,
          p256dh: json.keys.p256dh,
          auth_secret: json.keys.auth,
          target_url: window.location.pathname,
          enabled: true,
        }, { onConflict: "endpoint" });
        if (error) throw error;
        setPushReady(true);
      }
      setMessage("تم تفعيل إذن التنبيهات. ستصلك تحديثات الطلب حسب دعم المتصفح وإعدادات الجهاز.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تفعيل التنبيهات.");
    } finally {
      setNotificationsBusy(false);
    }
  }

  function startVisit() {
    const normalized = phoneToE164(phoneInput);
    if (!normalized) {
      setMessage("أدخل رقم جوال سعودي صحيحاً، مثل 05XXXXXXXX.");
      return;
    }
    window.sessionStorage.setItem("customer-visit-phone", normalized);
    setPhone(normalized);
    setPhoneInput(normalized);
    setLoading(true);
    setMessage("جارٍ تجهيز طاولتك...");
  }

  function resetClosedVisit() {
    window.sessionStorage.removeItem("customer-visit-phone");
    void supabase.auth.signOut().finally(() => window.location.reload());
  }

  async function sendOrder() {
    if (notificationPermission !== "granted" && notificationPermission !== "unsupported") {
      setMessage("فعّل إشعارات الطلب أولاً حتى نتمكن من تنبيهك عند تغيّر الحالة.");
      return;
    }
    if (!sessionId || !cartItems.length || !quote || busy || sessionStatus !== "open") return;
    setBusy(true);
    setMessage("");
    const { data, error } = await supabase.rpc("place_order", {
      p_session_id: sessionId,
      p_items: cartItems,
      p_notes: null,
      p_payment_method: paymentMethod,
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

  if (!phone) {
    return (
      <main className="customer-landing customer-onboarding" dir="rtl">
        <span className="eyebrow">أهلاً بك في مطعمك</span>
        <h1>ابدأ زيارتك<br/><em>من هنا.</em></h1>
        <p>أدخل رقم جوالك لربط طلبات هذه الزيارة بطاولتك ومتابعة حالة الطلب.</p>
        <form className="customer-phone-form" onSubmit={(event) => { event.preventDefault(); startVisit(); }}>
          <label htmlFor="customer-phone">رقم الجوال</label>
          <input id="customer-phone" inputMode="tel" autoComplete="tel" dir="ltr" placeholder="05XXXXXXXX" value={phoneInput} onChange={(event) => setPhoneInput(event.target.value)} maxLength={16}/>
          {message && <p className="customer-onboarding-error" role="alert">{message}</p>}
          <button className="action-button" type="submit">متابعة إلى القائمة <ArrowLeft size={17}/></button>
        </form>
        <small className="customer-privacy-note"><ShieldCheck size={15}/> رقمك يستخدم لربط الزيارة الحالية فقط. لا نعرض سجل أشخاص آخرين بمجرد إدخال رقم جوال.</small>
      </main>
    );
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
        <div className="restaurant-brand">
          <span className="restaurant-logo">{restaurant?.logo_path ? <img src={imageUrl(restaurant.logo_path) ?? ""} alt="" /> : <Store size={25}/>}</span>
          <div className="restaurant-identity">
            <span className="eyebrow">مرحباً بك في</span>
            <h1>{restaurant?.restaurant_name_ar || "مطعمك"}</h1>
            <p>{restaurant?.address ? <><MapPin size={14}/>{restaurant.address}</> : "قائمة طعامنا بين يديك"}</p>
          </div>
        </div>
        <div className="table-chip"><span>رقم الطاولة</span><strong>{tableNumber}</strong></div>
      </header>
      <div className="customer-context">
        <span><Clock size={15}/> اطلب مباشرة من طاولتك</span>
        {restaurant?.phone && <a href={"tel:" + restaurant.phone}><Phone size={15}/> تواصل معنا</a>}
        {!online && <span className="offline-inline"><WifiOff size={14}/> غير متصل</span>}
      </div>

      <section className="customer-notification-card" aria-live="polite">
        <span className="customer-notification-icon">{notificationPermission === "granted" ? <BellRing size={22}/> : <Bell size={22}/>}</span>
        <div className="customer-notification-copy">
          <strong>{notificationPermission === "granted" ? "تنبيهات الطلب مفعّلة" : "فعّل تنبيهات طلبك"}</strong>
          <p>{notificationPermission === "granted"
            ? (pushReady ? "سيصلك إشعار عند تحديث حالة الطلب، حتى عند مغادرة الصفحة." : "تم السماح بالتنبيهات. دعم وصولها بعد إغلاق الصفحة يتطلب إعداد خدمة Push للمتجر.")
            : notificationPermission === "denied"
              ? "الإشعارات محظورة من المتصفح. افتح إعدادات الموقع واسمح بها ثم اضغط تحقق."
              : notificationPermission === "unsupported"
                ? "هذا المتصفح لا يدعم إشعارات الويب؛ ستبقى تحديثات الطلب داخل الصفحة."
                : "نحتاج إذنك لإشعارك عند اعتماد الطلب وجاهزيته."}</p>
        </div>
        {notificationPermission !== "granted" && notificationPermission !== "unsupported" && (
          <button type="button" onClick={() => notificationPermission === "denied" ? setNotificationPermission(Notification.permission) : void enableNotifications()} disabled={notificationsBusy}>
            {notificationsBusy ? "جارٍ التفعيل..." : notificationPermission === "denied" ? "تحقق مجدداً" : "تفعيل"}
          </button>
        )}
      </section>

      {message && <p className="feedback" role="status">{message}</p>}
      {!online && <p className="offline-banner" role="status">لا يوجد اتصال، تظهر آخر حالة محفوظة وسيعاد الاتصال تلقائياً.</p>}

      {sessionStatus === "closed" ? (
        <section className="thanks-panel">
          <span aria-hidden="true"><Check size={34}/></span>
          <h2>شكراً لزيارتكم في {restaurant?.restaurant_name_ar || "مطعمك"}!</h2>
          <p>تم إغلاق الحساب وإتاحة الطاولة من جديد. بيانات الزيارة السابقة لن تظهر للعميل التالي.</p>
          <button className="action-button" type="button" onClick={resetClosedVisit}>إنهاء الزيارة والبدء من جديد</button>
        </section>
      ) : (
        <>
          <nav className="customer-tabs" aria-label="القائمة الرئيسية">
            <button aria-pressed={view === "menu"} onClick={() => setView("menu")}><UtensilsCrossed size={19}/><span>القائمة</span></button>
            <button aria-pressed={view === "cart"} onClick={() => setView("cart")}><ShoppingBag size={19}/><span>السلة</span>{cartCount > 0 && <i className="tab-count">{cartCount}</i>}</button>
            <button aria-pressed={view === "orders"} onClick={() => setView("orders")}><ClipboardList size={19}/><span>طلباتي</span>{orders.length > 0 && <i className="tab-count">{orders.length}</i>}</button>
          </nav>

          {view === "menu" && (
            <section className="customer-menu">
              <label className="menu-search-wrap"><Search size={19}/><input className="menu-search" type="search" aria-label="ابحث عن طبق" placeholder="ابحث عن طبقك المفضل..." value={search} onChange={(event) => setSearch(event.target.value)} />{search && <button type="button" onClick={() => setSearch("")} aria-label="مسح البحث"><X size={17}/></button>}</label>
              <div className="menu-heading"><div><span className="eyebrow">اكتشف قائمتنا</span><h2>وش ودّك تطلب؟</h2></div><div className="menu-heading-actions"><span className="menu-result-count">{filteredProducts.length} صنف</span><div className="product-view-switch" role="group" aria-label="طريقة عرض المنتجات"><button type="button" className={productLayout === "grid" ? "active" : ""} aria-pressed={productLayout === "grid"} onClick={() => changeProductLayout("grid")} aria-label="عرض بطاقات"><LayoutGrid size={18}/></button><button type="button" className={productLayout === "list" ? "active" : ""} aria-pressed={productLayout === "list"} onClick={() => changeProductLayout("list")} aria-label="عرض صفوف"><List size={19}/></button></div></div></div><div className="category-strip">
                <button className={activeCategory === "all" ? "selected" : ""} onClick={() => setActiveCategory("all")}>الكل</button>
                {categories.map((category) => (
                  <button className={activeCategory === category.id ? "selected" : ""} key={category.id} onClick={() => setActiveCategory(category.id)}>
                    {category.name_ar}
                  </button>
                ))}
              </div>
              <div className={`menu-grid ${productLayout === "list" ? "menu-list-view" : "menu-card-view"}`} data-layout={productLayout}>
                {filteredProducts.map((product) => {
                  const img = imageUrl(product.image_path);
                  return (
                    <article className="product-card" key={product.id}>
                      <button type="button" className="product-details-trigger" onClick={() => setSelectedProduct(product)} aria-label={"عرض تفاصيل " + product.name_ar}>
                        {img ? <img className="product-image" src={img} alt={product.name_ar} loading="lazy" /> : <div className="product-art" aria-hidden="true"><UtensilsCrossed size={34}/></div>}
                        {product.is_featured && <span className="product-featured-badge"><Sparkles size={13}/> مميز</span>}<span className="product-details-label"><span>التفاصيل</span><ArrowLeft size={15}/></span>
                      </button>
                      <h2>{product.name_ar}</h2>
                      {product.description_ar && <p className="product-description">{product.description_ar}</p>}
                      {product.station && <span className="product-station-chip"><ChefHat size={13}/>{({ kitchen: "المطبخ", grill: "الشواية", bar: "المشروبات", dessert: "الحلويات" } as Record<string,string>)[product.station] ?? product.station}</span>}
                      <strong className="product-price">{formatMoney(Number(product.price))}</strong>
                      {product.is_available ? (
                        <button className="product-add" onClick={() => changeQuantity(product.id, 1)}>
                          {cart[product.id] ? <><Check size={17}/> أضيف · {cart[product.id].quantity}</> : <><Plus size={17}/> أضف للسلة</>}
                        </button>
                      ) : <span className="unavailable-chip">غير متوفر حالياً</span>}
                    </article>
                  );
                })}
                {filteredProducts.length === 0 && <div className="empty-state">لا توجد أصناف تطابق بحثك.</div>}
              </div>
            </section>
          )}


          {selectedProduct && (
            <div className="product-detail-backdrop" role="presentation" onClick={() => setSelectedProduct(null)}>
              <section className="product-detail-sheet" role="dialog" aria-modal="true" aria-labelledby="product-detail-title" onClick={(event) => event.stopPropagation()}>
                <button type="button" className="product-detail-close" onClick={() => setSelectedProduct(null)} aria-label="إغلاق التفاصيل"><X size={21}/></button>
                {imageUrl(selectedProduct.image_path)
                  ? <img className="product-detail-image" src={imageUrl(selectedProduct.image_path)!} alt={selectedProduct.name_ar} />
                  : <div className="product-detail-image product-detail-image-empty"><UtensilsCrossed size={48}/></div>}
                <div className="product-detail-content">
                  <div className="product-detail-meta">
                    <span>{categories.find((category) => category.id === selectedProduct.category_id)?.name_ar ?? "من القائمة"}</span>
                    {selectedProduct.is_featured && <span className="product-featured-label">اختيار مميز</span>}
                  </div>
                  <h2 id="product-detail-title">{selectedProduct.name_ar}</h2>
                  {selectedProduct.name_en && <p className="product-detail-english" dir="ltr">{selectedProduct.name_en}</p>}
                  <p className="product-detail-description">{selectedProduct.description_ar?.trim() || "لا يوجد وصف إضافي لهذا المنتج حالياً."}</p>
                  <div className="product-detail-price-row"><span>السعر</span><strong>{formatMoney(Number(selectedProduct.price))}</strong></div>
                  {selectedProduct.station && <p className="product-detail-station">جهة التحضير: {({ kitchen: "المطبخ", grill: "الشواية", bar: "المشروبات", dessert: "الحلويات" } as Record<string,string>)[selectedProduct.station] ?? selectedProduct.station}</p>}
                  {selectedProduct.is_available
                    ? <button type="button" className="product-add product-detail-add" onClick={() => { changeQuantity(selectedProduct.id, 1); setSelectedProduct(null); }}><Plus size={18}/> أضف للسلة{cart[selectedProduct.id] ? " · الكمية الحالية " + cart[selectedProduct.id].quantity : ""}</button>
                    : <span className="unavailable-chip">غير متوفر حالياً</span>}
                </div>
              </section>
            </div>
          )}

          {view === "cart" && (
            <section className="cart-sheet">
              <header className="cart-hero">
                <div className="cart-hero-copy">
                  <span className="eyebrow">خطوة أخيرة قبل الاستمتاع</span>
                  <h2>سلة طلبك</h2>
                  <p>راجع اختياراتك وتأكد من تفاصيل طلبك</p>
                </div>
                <div className="cart-hero-icon"><ShoppingBag size={27}/><span>{cartCount}</span></div>
              </header>
              {cartItems.length === 0 ? (
                <div className="cart-empty-state">
                  <div className="cart-empty-icon"><ShoppingBag size={35}/></div>
                  <h3>سلتك تنتظر اختياراتك</h3>
                  <p>أضف أطباقك المفضلة من القائمة، وستظهر هنا لتراجعها قبل الإرسال.</p>
                  <button className="cart-continue-button" onClick={() => setView("menu")}><ArrowLeft size={17}/> استكشف القائمة</button>
                </div>
              ) : (
                <>
                  <div className="cart-section-heading">
                    <div><span className="eyebrow">اختياراتك</span><h3>تفاصيل الأصناف <small>{cartItems.length} أصناف</small></h3></div>
                    <button type="button" className="cart-continue-link" onClick={() => setView("menu")}>إضافة المزيد <Plus size={16}/></button>
                  </div>
                  <div className="cart-lines">
                    {cartItems.map((line) => {
                      const product = products.find((item) => item.id === line.product_id);
                      if (!product) return null;
                      const image = imageUrl(product.image_path);
                      return (
                        <article className="cart-line" key={line.product_id}>
                          <div className="cart-line-main">
                            <div className="cart-product-thumb">
                              {image ? <img src={image} alt={product.name_ar}/> : <UtensilsCrossed size={23}/>}
                            </div>
                            <div className="cart-product-info">
                              <strong>{product.name_ar}</strong>
                              <span>{formatMoney(Number(product.price))} <small>للوحدة</small></span>
                            </div>
                            <strong className="cart-line-total">{formatMoney(Number(product.price) * line.quantity)}</strong>
                          </div>
                          <div className="cart-line-controls">
                            <label className="item-note"><span>ملاحظات التحضير</span>
                              <input value={line.notes ?? ""} onChange={(event) => changeNotes(line.product_id, event.target.value)} placeholder="مثلاً: بدون بصل، الصوص على الجانب..." maxLength={250}/>
                            </label>
                            <div className="quantity-controls" aria-label="تعديل الكمية">
                              <button aria-label="زيادة الكمية" onClick={() => changeQuantity(line.product_id, 1)}><Plus size={16}/></button>
                              <strong>{line.quantity}</strong>
                              <button aria-label="تقليل الكمية" onClick={() => changeQuantity(line.product_id, -1)}><Minus size={16}/></button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  <section className="checkout-payment-card" aria-labelledby="checkout-payment-title">
                    <div className="checkout-payment-heading">
                      <span className="eyebrow">اختر ما يناسبك</span>
                      <h3 id="checkout-payment-title">طريقة الدفع</h3>
                      <p>حدد طريقة الدفع التي ستستخدمها عند استلام طلبك</p>
                    </div>
                    <div className="checkout-payment-options">
                      <button type="button" className={"checkout-payment-option " + (paymentMethod === "cash" ? "selected" : "")} aria-pressed={paymentMethod === "cash"} onClick={() => setPaymentMethod("cash")}>
                        <span className="checkout-payment-icon"><Banknote size={22}/></span>
                        <span><strong>نقداً (كاش)</strong><small>الدفع نقداً للموظف</small></span>
                        <i aria-hidden="true">{paymentMethod === "cash" ? <Check size={17}/> : null}</i>
                      </button>
                      <button type="button" className={"checkout-payment-option " + (paymentMethod === "card" ? "selected" : "")} aria-pressed={paymentMethod === "card"} onClick={() => setPaymentMethod("card")}>
                        <span className="checkout-payment-icon"><CreditCard size={22}/></span>
                        <span><strong>بطاقة عبر جهاز الشبكة</strong><small>الدفع لدى الموظف بجهاز الصراف</small></span>
                        <i aria-hidden="true">{paymentMethod === "card" ? <Check size={17}/> : null}</i>
                      </button>
                    </div>
                    <p className="checkout-payment-note">اختيار البطاقة لا يخصم المبلغ إلكترونياً؛ ستتم العملية على جهاز الشبكة لدى المطعم.</p>
                  </section>
                  <section className="cart-summary-card">
                    <div className="cart-summary-heading"><div><span className="eyebrow">ملخص الدفع</span><h3>تفاصيل الفاتورة</h3></div><span className="cart-secure-label"><Check size={13}/> تسعير دقيق</span></div>
                    <div className="quote-summary">
                      <div><span>المجموع الفرعي</span><strong>{quote ? formatMoney(quote.subtotal) : "—"}</strong></div>
                      <div><span>ضريبة القيمة المضافة</span><strong>{quote ? formatMoney(quote.vat_amount) : "—"}</strong></div>
                      <div className="quote-total"><span>الإجمالي شامل الضريبة</span><strong>{quote ? formatMoney(quote.total) : "جارٍ احتساب الإجمالي..."}</strong></div>
                    </div>
                    <p className="cart-summary-footnote">يتم احتساب الإجمالي والضريبة تلقائياً وفق أسعار المطعم.</p>
                  </section>
                  <div className="cart-checkout-area">
                    <div className="cart-checkout-total"><span>الإجمالي المستحق</span><strong>{quote ? formatMoney(quote.total) : "—"}</strong></div>
                    <button className="action-button send-order" disabled={!quote || busy || !online} onClick={() => void sendOrder()}>
                      {busy ? "جارٍ إرسال طلبك..." : <><ShoppingBag size={19}/> تأكيد الطلب وإرساله <ArrowLeft size={17}/></>}
                    </button>
                    {!online && <p className="cart-checkout-hint">تحقق من اتصال الإنترنت لإرسال طلبك.</p>}
                    {online && !quote && <p className="cart-checkout-hint">جارٍ تحديث الأسعار وحساب الضريبة...</p>}
                  </div>
                </>
              )}
            </section>
          )}

          {view === "orders" && (
            <section className="orders-list">
              <header className="orders-hero">
                <div><span className="eyebrow">تجربتك معنا</span><h2>طلباتي</h2><p>تابع طلباتك، راجع تفاصيلها، وأعد طلب ما تحب بسهولة.</p></div>
                <button type="button" className="orders-refresh" disabled={refreshingOrders || !online} onClick={async () => {
                  if (!sessionId) return;
                  setRefreshingOrders(true);
                  try { await refreshSession(sessionId); } finally { setRefreshingOrders(false); }
                }} aria-label="تحديث الطلبات"><RefreshCw size={18} className={refreshingOrders ? "spin" : ""}/></button>
              </header>
              <div className="orders-overview">
                <article className="orders-stat orders-stat-total"><span>إجمالي الطلبات</span><strong>{orders.length}</strong><small><ReceiptText size={14}/> طلب مسجل</small></article>
                <article className="orders-stat orders-stat-active"><span>طلبات نشطة</span><strong>{orders.filter((order) => ["pending","approved","preparing","ready","served"].includes(order.status)).length}</strong><small><Timer size={14}/> قيد المتابعة</small></article>
                <article className="orders-stat orders-stat-spend"><span>إجمالي مشترياتك</span><strong>{formatMoney(orders.reduce((sum, order) => sum + Number(order.total), 0))}</strong><small><CircleCheck size={14}/> شامل الضريبة</small></article>
              </div>
              <div className="orders-filter-bar" role="group" aria-label="تصفية الطلبات">
                {([["all","الكل"],["active","النشطة"],["completed","المكتملة"],["rejected","المرفوضة"]] as const).map(([key,label]) => (
                  <button type="button" key={key} className={orderFilter === key ? "active" : ""} aria-pressed={orderFilter === key} onClick={() => setOrderFilter(key)}>
                    {label}<span>{key === "all" ? orders.length : key === "active" ? orders.filter((order) => ["pending","approved","preparing","ready","served"].includes(order.status)).length : key === "completed" ? orders.filter((order) => order.status === "paid").length : orders.filter((order) => order.status === "rejected").length}</span>
                  </button>
                ))}
              </div>
              {orders.length === 0 ? (
                <div className="orders-empty-pro"><div className="orders-empty-art"><ClipboardList size={38}/></div><h3>بداية لذيذة تنتظرك</h3><p>لم ترسل أي طلب حتى الآن. تصفح القائمة واختر ما تشتهيه.</p><button className="action-button" onClick={() => setView("menu")}>اكتشف القائمة <ArrowLeft size={17}/></button></div>
              ) : (
                <div className="orders-feed">
                  {orders.filter((order) => orderFilter === "all" || (orderFilter === "active" && ["pending","approved","preparing","ready","served"].includes(order.status)) || (orderFilter === "completed" && order.status === "paid") || (orderFilter === "rejected" && order.status === "rejected")).map((order) => {
                    const currentIndex = statusSteps.findIndex((step) => step.key === order.status);
                    const rejected = order.status === "rejected";
                    const complete = order.status === "paid";
                    const items = orderItemMap.get(order.id) ?? [];
                    const expanded = expandedOrders.includes(order.id);
                    const statusLabel = rejected ? "تم رفض الطلب" : statusSteps[Math.max(0, currentIndex)]?.label ?? order.status;
                    const statusClass = rejected ? "rejected" : complete ? "completed" : "active";
                    return (
                      <article className={"guest-order-card order-card-pro " + statusClass} key={order.id}>
                        <div className="order-card-accent"/>
                        <div className="order-card-header"><div className="order-number-block"><span>رقم الطلب</span><strong>#{order.order_no}</strong></div><span className={"order-status-pill " + statusClass}>{rejected ? <AlertCircle size={14}/> : complete ? <Check size={14}/> : <Timer size={14}/>} {statusLabel}</span></div>
                        <div className="order-card-meta">
                          <span><CalendarDays size={14}/>{new Date(order.placed_at).toLocaleString("ar-SA",{dateStyle:"medium",timeStyle:"short"})}</span>
                          <span>{items.length} أصناف</span>
                          <span>{order.payment_method === "card" ? <CreditCard size={14}/> : <Banknote size={14}/>} {order.payment_method === "card" ? "شبكة" : "كاش"}</span>
                        </div>
                        {!rejected && <div className={"order-progress-pro " + (complete ? "is-complete" : "")}>{statusSteps.map((step,index) => <div className={"order-progress-step " + (index <= currentIndex ? "done" : "")} key={step.key}><i>{index < currentIndex || complete ? <Check size={11}/> : index + 1}</i><span>{step.label}</span></div>)}</div>}
                        {rejected && <div className="order-rejected-note"><AlertCircle size={16}/><span>سبب الرفض: {order.rejected_reason || "يرجى التواصل مع الموظف لمزيد من التفاصيل."}</span></div>}
                        <div className="order-card-total-row"><span>إجمالي الطلب</span><strong>{formatMoney(Number(order.total))}</strong></div>
                        <button type="button" className="order-details-toggle" aria-expanded={expanded} onClick={() => setExpandedOrders((current) => expanded ? current.filter((id) => id !== order.id) : [...current,order.id])}><span>{expanded ? "إخفاء التفاصيل" : "عرض تفاصيل الطلب"} <small>{items.length} أصناف</small></span>{expanded ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}</button>
                        {expanded && <div className="order-details-panel">
                          <div className="order-items-table">{items.map((item) => <div className="order-item-row" key={item.id}><div className="order-item-name"><strong>{item.name_ar}</strong><small>{formatMoney(Number(item.unit_price))} × {item.quantity}{item.notes ? " · " + item.notes : ""}</small></div><b>{formatMoney(Number(item.line_total))}</b></div>)}{items.length === 0 && <p className="order-no-items">لا توجد تفاصيل أصناف متاحة لهذا الطلب.</p>}</div>
                          <div className="order-price-breakdown"><div><span>المجموع الفرعي</span><strong>{formatMoney(Number(order.subtotal))}</strong></div><div><span>ضريبة القيمة المضافة</span><strong>{formatMoney(Number(order.vat_amount))}</strong></div><div className="order-grand-total"><span>الإجمالي</span><strong>{formatMoney(Number(order.total))}</strong></div></div>
                          {order.notes && <p className="order-general-note">ملاحظات الطلب: {order.notes}</p>}
                        </div>}
                        <div className="order-card-actions"><button type="button" className="order-repeat-button" disabled={busy || !items.length} onClick={() => {
                          const next: Record<string,CartLine> = {};
                          let skipped = 0;
                          for (const item of items) {
                            const product = products.find((candidate) => candidate.id === item.product_id && candidate.is_available);
                            if (!product) { skipped += 1; continue; }
                            const previous = next[item.product_id];
                            next[item.product_id] = { quantity: Math.min(20,(previous?.quantity ?? 0) + Number(item.quantity)), notes: item.notes ?? previous?.notes ?? "" };
                          }
                          if (!Object.keys(next).length) { setMessage("أصناف هذا الطلب لم تعد متوفرة حالياً."); return; }
                          setCart((current) => { const merged = { ...current }; for (const [id,line] of Object.entries(next)) merged[id] = { quantity: Math.min(20,(merged[id]?.quantity ?? 0) + line.quantity), notes: line.notes || merged[id]?.notes || "" }; return merged; });
                          setView("cart");
                          setMessage(skipped ? "أعدنا الأصناف المتاحة فقط، وبعض الأصناف لم تعد متوفرة." : "تمت إضافة أصناف الطلب السابق إلى سلتك.");
                        }}><RotateCcw size={16}/> إعادة الطلب</button></div>
                      </article>
                    );
                  })}
                  {orders.filter((order) => orderFilter === "all" || (orderFilter === "active" && ["pending","approved","preparing","ready","served"].includes(order.status)) || (orderFilter === "completed" && order.status === "paid") || (orderFilter === "rejected" && order.status === "rejected")).length === 0 && <div className="orders-filter-empty">لا توجد طلبات ضمن هذا التصنيف.</div>}
                </div>
              )}
              {billRequest?.status === "requested" && <p className="bill-status"><Check size={16}/> تم إرسال طلب الحساب. النادل في الطريق إليك.</p>}
              {billRequest?.status === "acknowledged" && <p className="bill-status"><Check size={16}/> اطّلع النادل على طلب الحساب، وسيأتي إليك قريباً.</p>}
              <button className="bill-button orders-bill-button" disabled={busy || !!billRequest || !online || !orders.length} onClick={() => void requestBill()}>{billRequest ? <><Check size={18}/> تم طلب الحساب</> : <>اطلب النادل للدفع <ArrowLeft size={17}/></>}</button>
            </section>
          )}
        </>
      )}
    </main>
  );
}
