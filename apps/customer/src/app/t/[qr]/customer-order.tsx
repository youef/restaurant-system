"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@restaurant/db/client";
import { useRealtimeRefresh } from "@restaurant/realtime";
import { formatMoney } from "@restaurant/i18n";
import { Search, ShoppingBag, ClipboardList, UtensilsCrossed, Plus, Minus, X, WifiOff, ArrowLeft, Check, Store, MapPin, Phone, Clock, LayoutGrid, List, Sparkles, ChefHat, Flame, Banknote, CreditCard, RefreshCw, ChevronDown, ChevronUp, RotateCcw, CalendarDays, ReceiptText, CircleCheck, Timer, AlertCircle, Bell, BellRing, ShieldCheck, ScanLine } from "lucide-react";

type Category = { id: string; name_ar: string; name_en: string | null; sort_order: number };
type RestaurantSettings = { restaurant_name_ar: string; restaurant_name_en: string | null; logo_path: string | null; phone: string | null; address: string | null; opening_hours: Record<string, unknown> | null; timezone?: string; meal_period_hours?: Record<string,{start:string;end:string}> };
type Product = {
  id: string; category_id: string; name_ar: string; name_en: string | null;
  description_ar: string | null; price: number; image_path: string | null;
  is_available: boolean; is_featured: boolean; sort_order: number; station: string | null; meal_period: "all" | "breakfast" | "lunch" | "dinner";
};
type Order = {
  id: string; session_id: string; order_no: number; status: string; subtotal: number; vat_amount: number;
  total: number; notes: string | null; rejected_reason: string | null; placed_at: string; payment_method: "cash" | "card";
};
type OrderItem = {
  id: string; order_id: string; product_id: string; name_ar: string; unit_price: number; quantity: number;
  notes: string | null; line_total: number; station: string;
};
type CartLine = { quantity: number; notes: string };
type Quote = { subtotal: number; vat_amount: number; total: number };
type BillRequest = { id: string; status: "requested" | "acknowledged" | "closed" };
type CustomerTable = { table_number: number; seats: number; status: "available" | "occupied" | "out_of_service" };
type LoyaltySummary = { points_balance: number; lifetime_points: number; membership_level: string };
type Coupon = { id: string; code: string; title: string; description: string | null; discount_percent: number | null; discount_amount: number | null };

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
type QrDetector = { detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>> };
type QrDetectorConstructor = new (options: { formats: string[] }) => QrDetector;
type JsQrDecoder = (data: Uint8ClampedArray, width: number, height: number, options?: { inversionAttempts?: string }) => { data: string } | null;

async function loadJsQr(): Promise<JsQrDecoder> {
  const win = window as Window & { jsQR?: JsQrDecoder };
  if (win.jsQR) return win.jsQR;
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-customer-jsqr="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("تعذر تحميل قارئ QR. تحقق من اتصال الإنترنت.")), { once: true });
      if (win.jsQR) resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";
    script.async = true;
    script.dataset.customerJsqr = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("تعذر تحميل قارئ QR. تحقق من اتصال الإنترنت."));
    document.head.appendChild(script);
  });
  if (!win.jsQR) throw new Error("تعذر تهيئة قارئ QR على هذا الجهاز.");
  return win.jsQR;
}

function extractQrToken(value: string) {
  const raw = value.trim();
  if (/^\d{1,4}$/.test(raw)) return String(Number(raw));
  const uuid = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)?.[0];
  if (uuid) return uuid;
  try {
    const parsed = new URL(raw);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const tableIndex = parts.findIndex((part) => part.toLowerCase() === "t");
    if (tableIndex >= 0 && parts[tableIndex + 1]) return extractQrToken(parts[tableIndex + 1]);
  } catch { /* raw QR content may not be a URL */ }
  return null;
}
export function CustomerOrder({ qr }: { qr: string }) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const tableRevision = useRealtimeRefresh("restaurant_tables");
  const [tableNumber, setTableNumber] = useState<number | null>(null);
  const [tableChoices, setTableChoices] = useState<CustomerTable[]>([]);
  const [phone, setPhone] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [birthYearInput, setBirthYearInput] = useState("");
  const [birthMonthInput, setBirthMonthInput] = useState("");
  const [birthDayInput, setBirthDayInput] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [scannedQr, setScannedQr] = useState<string | null>(null);
  const [qrInput, setQrInput] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const scannerFrameRef = useRef<number | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("default");
  const [notificationsBusy, setNotificationsBusy] = useState(false);
  const [pushReady, setPushReady] = useState(false);
  const previousOrderStatuses = useRef<Record<string, string>>({});
  const audioContextRef = useRef<AudioContext | null>(null);
  const [restaurant, setRestaurant] = useState<RestaurantSettings | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<"open" | "closed">("open");
  const [exitRequestedAt, setExitRequestedAt] = useState<string | null>(null);
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
  const [clockTick, setClockTick] = useState(0);
  const [loyalty, setLoyalty] = useState<LoyaltySummary | null>(null);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [serviceBusy, setServiceBusy] = useState(false);

  useEffect(() => { const timer = window.setInterval(() => setClockTick(v=>v+1), 60000); return () => window.clearInterval(timer); }, []);\n\n  useEffect(() => {\n    if (!customerId) { setLoyalty(null); setCoupons([]); return; }\n    let active=true;\n    Promise.all([supabase.rpc("get_my_loyalty_summary"),supabase.from("coupons").select("id,code,title,description,discount_percent,discount_amount").eq("is_active",true).order("created_at",{ascending:false})]).then(([loyaltyResult,couponResult])=>{ if(!active)return; const row=Array.isArray(loyaltyResult.data)?loyaltyResult.data[0]:loyaltyResult.data; if(!loyaltyResult.error && row) setLoyalty(row as LoyaltySummary); if(!couponResult.error) setCoupons((couponResult.data??[]) as Coupon[]); });\n    return ()=>{active=false;};\n  },[customerId,supabase]);\n\n  async function requestService(type:"water"|"napkins"|"cutlery"|"waiter") {\n    if(!sessionId || serviceBusy || !online) return; setServiceBusy(true);\n    const {error}=await supabase.rpc("create_service_request",{p_session_id:sessionId,p_request_type:type,p_note:null});\n    setServiceBusy(false); setMessage(error?.message ?? "تم إرسال طلب الخدمة إلى النادل.");\n  }\n\n  function stopQrScanner() {
    if (scannerFrameRef.current !== null) window.cancelAnimationFrame(scannerFrameRef.current);
    scannerFrameRef.current = null;
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    setCameraActive(false);
  }

  async function startQrScanner() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage("الكاميرا تحتاج إلى HTTPS ومتصفح يسمح بالوصول إليها. افتح الرابط في Safari أو Chrome واسمح بالكاميرا.");
      return;
    }
    try {
      stopQrScanner();
      // Open the camera first. A QR decoder/CDN failure must never prevent the live preview.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      cameraStreamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("تعذر عرض الكاميرا. أعد المحاولة.");
      video.setAttribute("playsinline", "true");
      video.setAttribute("autoplay", "true");
      video.muted = true;
      video.srcObject = stream;
      await video.play();
      setCameraActive(true);
      setMessage("الكاميرا تعمل. وجّهها إلى رمز QR أو اختر رقم الطاولة من القائمة.");

      const Detector = (window as unknown as { BarcodeDetector?: QrDetectorConstructor }).BarcodeDetector;
      const detector = Detector ? new Detector({ formats: ["qr_code"] }) : null;
      let decodeWithJsQr: JsQrDecoder | null = null;
      if (!detector) {
        try {
          decodeWithJsQr = await loadJsQr();
        } catch (decoderError) {
          setMessage(decoderError instanceof Error ? decoderError.message + " يمكنك اختيار الطاولة من القائمة أو إدخال رقمها يدوياً." : "تعذر تحميل قارئ QR. اختر الطاولة من القائمة أو أدخل رقمها يدوياً.");
          return;
        }
      }

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        setMessage("الكاميرا تعمل، لكن تعذر تهيئة قارئ الرمز. اختر الطاولة من القائمة.");
        return;
      }
      let lastScanAt = 0;
      const scan = async () => {
        if (!cameraStreamRef.current || !videoRef.current) return;
        const currentVideo = videoRef.current;
        if (currentVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && currentVideo.videoWidth > 0) {
          const now = performance.now();
          if (now - lastScanAt >= 180) {
            lastScanAt = now;
            try {
              let rawValue: string | null = null;
              if (detector) {
                const codes = await detector.detect(currentVideo);
                rawValue = codes[0]?.rawValue ?? null;
              } else if (decodeWithJsQr) {
                const width = Math.min(currentVideo.videoWidth, 960);
                const height = Math.round(currentVideo.videoHeight * (width / currentVideo.videoWidth));
                canvas.width = width;
                canvas.height = height;
                context.drawImage(currentVideo, 0, 0, width, height);
                const pixels = context.getImageData(0, 0, width, height);
                rawValue = decodeWithJsQr(pixels.data, width, height, { inversionAttempts: "attemptBoth" })?.data ?? null;
              }
              const token = rawValue ? extractQrToken(rawValue) : null;
              if (token) {
                stopQrScanner();
                setQrInput(token);
                setScannedQr(token);
                setLoading(true);
                setMessage("تمت قراءة رقم الطاولة، جارٍ التحقق من حالتها...");
                return;
              }
            } catch { /* keep the preview running while scanning */ }
          }
        }
        if (cameraStreamRef.current) scannerFrameRef.current = window.requestAnimationFrame(() => void scan());
      };
      void scan();
    } catch (error) {
      stopQrScanner();
      const name = error instanceof DOMException ? error.name : "";
      const message = name === "NotAllowedError"
        ? "لم تسمح للمتصفح باستخدام الكاميرا. افتح إعدادات الموقع وفعّل إذن الكاميرا ثم أعد المحاولة."
        : name === "NotFoundError"
          ? "لم نعثر على كاميرا في هذا الجهاز."
          : name === "NotReadableError"
            ? "الكاميرا مستخدمة في تطبيق آخر. أغلقه ثم أعد المحاولة."
            : error instanceof Error ? error.message : "تعذر فتح الكاميرا. تأكد من إذن الكاميرا ثم أعد المحاولة.";
      setMessage(message);
    }
  }
  useEffect(() => () => {
    if (scannerFrameRef.current !== null) window.cancelAnimationFrame(scannerFrameRef.current);
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const refreshSession = useCallback(async (id: string, profileId: string) => {
    const [orderResult, sessionResult, billResult] = await Promise.all([
      supabase.from("orders")
        .select("id,session_id,order_no,status,subtotal,vat_amount,total,notes,rejected_reason,placed_at,payment_method")
        .eq("customer_id", profileId)
        .order("placed_at", { ascending: false }),
      supabase.from("table_sessions").select("status,customer_exit_requested_at").eq("id", id).maybeSingle(),
      supabase.from("bill_requests").select("id,status").eq("session_id", id)
        .in("status", ["requested", "acknowledged", "closed"])
        .order("requested_at", { ascending: false }).limit(1).maybeSingle(),
    ]);

    if (orderResult.error) throw orderResult.error;
    const nextOrders = (orderResult.data ?? []) as Order[];
    setOrders(nextOrders);
    if (sessionResult.data?.status) setSessionStatus(sessionResult.data.status as "open" | "closed");
    setExitRequestedAt((sessionResult.data?.customer_exit_requested_at as string | null) ?? null);
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
    const savedBirthYear = window.sessionStorage.getItem("customer-visit-birth-year");
    const savedBirthMonth = window.sessionStorage.getItem("customer-visit-birth-month");
    const savedBirthDay = window.sessionStorage.getItem("customer-visit-birth-day");
    if (savedPhone) setPhoneInput(savedPhone);
    if (savedBirthYear) setBirthYearInput(savedBirthYear);
    if (savedBirthMonth) setBirthMonthInput(savedBirthMonth);
    if (savedBirthDay) setBirthDayInput(savedBirthDay);
    if (savedPhone && savedBirthYear) {
      setPhone(savedPhone);
      setBirthYear(savedBirthYear);
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
    if (!customerId) {
      setTableChoices([]);
      return;
    }
    let active = true;
    async function refreshTableChoices() {
      const { data, error } = await supabase.rpc("list_customer_tables");
      if (!active) return;
      if (error) {
        setMessage(error.message);
        return;
      }
      setTableChoices((data ?? []) as CustomerTable[]);
    }
    void refreshTableChoices();
    return () => { active = false; };
  }, [customerId, tableRevision, supabase]);

  useEffect(() => {
    let active = true;
    async function bootstrap() {
      if (!phone || !birthYear) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setMessage("جارٍ التحقق من بياناتك...");
      const { data: authData } = await supabase.auth.getUser();
      let guestUser = authData.user;
      if (!guestUser) {
        const { data: signInData, error: authError } = await supabase.auth.signInAnonymously();
        if (authError) throw new Error("تعذر بدء جلسة العميل. تأكد من تفعيل تسجيل الدخول المجهول في Supabase.");
        guestUser = signInData.user;
      }
      if (!guestUser) throw new Error("تعذر إنشاء جلسة العميل.");
      const { data: claimData, error: claimError } = await supabase.rpc("claim_customer_profile", {
        p_phone_e164: phoneToE164(phone),
        p_birth_year_hijri: Number(birthYear),
      });
      if (claimError) throw claimError;
      const claim = Array.isArray(claimData) ? claimData[0] : claimData;
      if (!claim?.verified || !claim.customer_id) {
        const reason = claim?.error_code === "temporarily_locked"
          ? "تم إيقاف المحاولة مؤقتاً لكثرة المحاولات. حاول بعد 15 دقيقة."
          : claim?.error_code === "identity_mismatch"
            ? "سنة الميلاد غير مطابقة لهذا الرقم. راجع السنة وحاول مرة أخرى."
            : "تأكد من رقم الجوال وسنة الميلاد الهجرية.";
        throw new Error(reason);
      }
      const profileId = claim.customer_id as string;
      const savedMonth = window.sessionStorage.getItem("customer-visit-birth-month");
      const savedDay = window.sessionStorage.getItem("customer-visit-birth-day");
      if (savedMonth && savedDay) {
        const { error: birthdayError } = await supabase.rpc("update_customer_birthday", { p_month: Number(savedMonth), p_day: Number(savedDay) });
        if (birthdayError) throw birthdayError;
      }
      if (active) setCustomerId(profileId);

      const { error: contactError } = await supabase.from("customer_contacts").upsert({
        user_id: guestUser.id,
        phone_e164: phoneToE164(phone),
      }, { onConflict: "user_id", ignoreDuplicates: true });
      if (contactError) throw new Error("تعذر حفظ رقم الجوال بشكل آمن: " + contactError.message);

      const selectedQr = scannedQr ?? extractQrToken(qr);
      if (!selectedQr) {
        if (active) setMessage("تم التحقق من بياناتك. اختر طاولة متاحة من القائمة أو امسح رمز QR المثبت عليها.");
        return;
      }

      let tableQrToken = selectedQr;
      if (/^\d{1,4}$/.test(selectedQr)) {
        const { data: numberedTable, error: numberError } = await supabase.rpc("resolve_table_number", {
          p_table_number: Number(selectedQr),
        });
        if (numberError || !numberedTable?.length) throw new Error("رقم الطاولة غير موجود. تأكد من الرقم الموجود على الطاولة.");
        tableQrToken = numberedTable[0].qr_token as string;
      }
      const { data: resolved, error: resolveError } = await supabase.rpc("resolve_table", { p_qr: tableQrToken });
      if (resolveError || !resolved?.length) throw new Error("رمز الطاولة غير صحيح أو لم يعد متاحاً.");
      const table = resolved[0] as { table_number: number; status: string };
      if (table.status === "out_of_service") throw new Error("الطاولة " + table.table_number + " خارج الخدمة حالياً.");
      if (active) setTableNumber(table.table_number);

      const { data: joined, error: joinError } = await supabase.rpc("join_table_session", { p_qr: tableQrToken });
      if (joinError || !joined) throw new Error(joinError?.message ?? "تعذر فتح جلسة الطاولة.");
      const id = joined as string;
      if (!active) return;
      setSessionId(id);

      const [categoryResult, productResult, settingsResult] = await Promise.all([
        supabase.from("categories").select("id,name_ar,name_en,sort_order")
          .eq("is_active", true).order("sort_order"),
        supabase.from("products")
          .select("id,category_id,name_ar,name_en,description_ar,price,image_path,is_available,is_featured,sort_order,station,meal_period")
          .eq("is_active", true).order("sort_order"),
        supabase.from("settings").select("restaurant_name_ar,restaurant_name_en,logo_path,phone,address,opening_hours,timezone,meal_period_hours").eq("id", 1).maybeSingle(),
      ]);
      if (categoryResult.error) throw categoryResult.error;
      if (productResult.error) throw productResult.error;
      if (active) {
        setCategories((categoryResult.data ?? []) as Category[]);
        setProducts((productResult.data ?? []) as Product[]);
        setRestaurant((settingsResult.data ?? null) as RestaurantSettings | null);
        setMessage("");
      }
      await refreshSession(id, profileId);
    }

    void bootstrap().catch((error: unknown) => {
      if (active) {
        const errorMessage = error instanceof Error ? error.message : "تعذر تحميل القائمة.";
        setMessage(errorMessage);
        setScannedQr(null);
        if (errorMessage.includes("سنة الميلاد") || errorMessage.includes("المحاولة مؤقتاً")) {
          setPhone("");
          setCustomerId(null);
          window.sessionStorage.removeItem("customer-visit-phone");
          window.sessionStorage.removeItem("customer-visit-birth-year");
    window.sessionStorage.removeItem("customer-visit-birth-month");
    window.sessionStorage.removeItem("customer-visit-birth-day");
        }
      }
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => { active = false; };
  }, [phone, birthYear, scannedQr, qr, refreshSession, supabase]);

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
    if (!sessionId || !customerId) return;
    let active = true;
    const refresh = () => {
      void refreshSession(sessionId, customerId).catch(() => {
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
  }, [customerId, refreshSession, sessionId, supabase]);

  useEffect(() => {
    if (!sessionId || sessionStatus === "closed" || orders.some((order) => order.session_id === sessionId)) return;
    const heartbeat = () => { void supabase.rpc("touch_table_reservation", { p_session_id: sessionId }); };
    heartbeat();
    const timer = window.setInterval(heartbeat, 60_000);
    return () => window.clearInterval(timer);
  }, [orders, sessionId, sessionStatus, supabase]);

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
    return matchesMeal && matchesCategory && matchesSearch;
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
    const hijriYear = Number(birthYearInput);
    if (!normalized) {
      setMessage("أدخل رقم جوال سعودي صحيحاً، مثل 05XXXXXXXX.");
      return;
    }
    if (!Number.isInteger(hijriYear) || hijriYear < 1300 || hijriYear > 1500) {
      setMessage("أدخل سنة ميلاد هجرية صحيحة (من 1300 إلى 1500).");
      return;
    }
    const normalizedYear = String(hijriYear);
    window.sessionStorage.setItem("customer-visit-phone", normalized);
    window.sessionStorage.setItem("customer-visit-birth-year", normalizedYear);
    const month = Number(birthMonthInput), day = Number(birthDayInput);
    if (birthMonthInput || birthDayInput) {
      if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > 30) { setMessage("أدخل اليوم والشهر الهجريين بشكل صحيح، أو اتركهما فارغين."); return; }
      window.sessionStorage.setItem("customer-visit-birth-month", String(month));
      window.sessionStorage.setItem("customer-visit-birth-day", String(day));
    } else { window.sessionStorage.removeItem("customer-visit-birth-month"); window.sessionStorage.removeItem("customer-visit-birth-day"); }
    setPhone(normalized);
    setPhoneInput(normalized);
    setBirthYear(normalizedYear);
    setBirthYearInput(normalizedYear);
    setLoading(true);
    setMessage("جارٍ التحقق من بياناتك وتجهيز الطاولة...");
  }

  async function recordLogoutAndSignOut(alreadyClosed = false) {
    if (busy) return;
    const confirmation = alreadyClosed
      ? "تم إغلاق الزيارة نهائياً. هل تريد تسجيل الخروج والعودة إلى شاشة البداية؟"
      : "هل تريد تسجيل الخروج؟ سيبقى حساب الطاولة مفتوحاً حتى يُغلقه الموظف بعد التسوية.";
    if (!window.confirm(confirmation)) return;
    setBusy(true);
    const { error } = await supabase.rpc("record_customer_logout", { p_session_id: sessionId });
    if (error) {
      setBusy(false);
      setMessage("تعذر تسجيل الخروج في سجل الزيارة: " + error.message);
      return;
    }
    window.sessionStorage.removeItem("customer-visit-phone");
    window.sessionStorage.removeItem("customer-visit-birth-year");
    await supabase.auth.signOut();
    window.location.reload();
  }

  function resetClosedVisit() {
    void recordLogoutAndSignOut(true);
  }

  async function requestCustomerExit() {
    if (!sessionId || busy || sessionStatus !== "open" || exitRequestedAt || !online) return;
    if (!window.confirm("سيتم إرسال طلب إنهاء الزيارة إلى النادل. لن تُغلق الطاولة نهائياً حتى تتم تسوية الحساب من الموظف. متابعة؟")) return;
    setBusy(true);
    setMessage("");
    const { data, error } = await supabase.rpc("request_customer_exit", { p_session_id: sessionId });
    setBusy(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    if (customerId) await refreshSession(sessionId, customerId);
    setMessage(data
      ? "تم تسجيل طلب مغادرة الطاولة وإبلاغ النادل. انتظر تسوية الحساب وإغلاق الجلسة."
      : "لم توجد طلبات معلّقة؛ تم إنهاء الزيارة وتحرير الطاولة مباشرة.");
  }

  async function sendOrder() {
    if (notificationPermission !== "granted" && notificationPermission !== "unsupported") {
      setMessage("فعّل إشعارات الطلب أولاً حتى نتمكن من تنبيهك عند تغيّر الحالة.");
      return;
    }
    if (!sessionId || !cartItems.length || !quote || busy || sessionStatus !== "open" || exitRequestedAt) return;
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
    if (customerId) await refreshSession(sessionId, customerId);
  }

  async function requestBill() {
    if (!sessionId || busy || sessionStatus === "closed") return;
    setBusy(true);
    const { error } = await supabase.rpc("request_bill", { p_session_id: sessionId });
    setBusy(false);
    if (error) setMessage(error.message);
    else {
      setMessage("تم طلب الحساب. النادل في الطريق إليك.");
      if (customerId) await refreshSession(sessionId, customerId);
    }
  }

  if (!phone) {
    return (
      <main className="customer-landing customer-onboarding" dir="rtl">
        <span className="eyebrow">أهلاً بك في مطعمك</span>
        <h1>ابدأ زيارتك<br/><em>من هنا.</em></h1>
        <p>أدخل رقم جوالك وسنة ميلادك الهجرية لربط طلباتك وفواتيرك بكل زياراتك، حتى لو جلست على طاولة مختلفة.</p>
        <form className="customer-phone-form" onSubmit={(event) => { event.preventDefault(); startVisit(); }}>
          <label htmlFor="customer-phone">رقم الجوال</label>
          <input id="customer-phone" inputMode="tel" autoComplete="tel" dir="ltr" placeholder="05XXXXXXXX" value={phoneInput} onChange={(event) => setPhoneInput(event.target.value)} maxLength={16}/>
          <label htmlFor="customer-hijri-year">سنة الميلاد بالهجري</label>
          <input id="customer-hijri-year" inputMode="numeric" type="number" min="1300" max="1500" placeholder="مثال: 1410" value={birthYearInput} onChange={(event) => setBirthYearInput(event.target.value)} />
          <div className="admin-form-grid"><label>شهر الميلاد الهجري (اختياري)<select value={birthMonthInput} onChange={e=>setBirthMonthInput(e.target.value)}><option value="">اختر الشهر</option>{Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{["محرم","صفر","ربيع الأول","ربيع الآخر","جمادى الأولى","جمادى الآخرة","رجب","شعبان","رمضان","شوال","ذو القعدة","ذو الحجة"][i]}</option>)}</select></label><label>يوم الميلاد الهجري (اختياري)<input type="number" min="1" max="30" value={birthDayInput} onChange={e=>setBirthDayInput(e.target.value)} placeholder="1 - 30"/></label></div>
          {message && <p className="customer-onboarding-error" role="alert">{message}</p>}
          <button className="action-button" type="submit">متابعة إلى القائمة <ArrowLeft size={17}/></button>
        </form>
        <small className="customer-privacy-note"><ShieldCheck size={15}/> لا نرسل رسائل نصية. تاريخ الميلاد الهجري الإضافي اختياري ويستخدم لتقديم مكافأة في يوم ميلادك.</small>
      </main>
    );
  }

  if (loading) {
    return <main className="customer-landing" dir="rtl"><span className="eyebrow">أهلاً بك</span><h1>نتحقق من بياناتك</h1><p>بعد التحقق امسح رمز QR المثبت على الطاولة لفتح القائمة.</p></main>;
  }

  if (!sessionId) {
    return (
      <main className="customer-landing customer-onboarding customer-qr-onboarding" dir="rtl">
        <span className="eyebrow">تم التحقق من بيانات العميل</span>
        <h1>امسح رمز<br/><em>طاولتك.</em></h1>
        <p>{qr ? "بعد التحقق من بياناتك، امسح رمز الطاولة الذي يظهر عليه رقمها من داخل المطعم." : "افتح الكاميرا وامسح رمز QR الذي يحمل رقم الطاولة. نتحقق من توفرها قبل فتح القائمة."}</p>
        {message && <p className="customer-onboarding-error" role="status">{message}</p>}
        <div className={"customer-qr-camera " + (cameraActive ? "active" : "")}>
          <video ref={videoRef} playsInline muted aria-label="كاميرا مسح رمز الطاولة" />
          {!cameraActive && <div><span><ScanLine size={34}/></span><strong>الكاميرا جاهزة للمسح</strong><small>سنستخدم الكاميرا الخلفية لقراءة رقم الطاولة</small></div>}
        </div>
        <button className="action-button customer-qr-start" type="button" onClick={() => cameraActive ? stopQrScanner() : void startQrScanner()}><ScanLine size={18}/> {cameraActive ? "إيقاف الكاميرا" : "فتح الكاميرا ومسح الطاولة"}</button>
        <section className="customer-table-picker" aria-label="قائمة الطاولات">
          <div className="customer-table-picker-heading"><div><strong>اختر رقم الطاولة</strong><small>المتاح يمكن اختياره، والمشغول يظهر رقمه ولا يمكن اختياره</small></div><span>{tableChoices.filter((table) => table.status === "available").length} متاحة</span></div>
          <div className="customer-table-picker-grid">
            {tableChoices.map((table) => {
              const available = table.status === "available";
              const label = available ? "متاحة" : table.status === "occupied" ? "مشغولة" : "خارج الخدمة";
              return (
                <button key={table.table_number} type="button" disabled={!available}
                  className={"customer-table-choice " + (available ? "available" : "unavailable")}
                  onClick={async () => {
                    setLoading(true);
                    setMessage("جارٍ فتح رابط الطاولة " + table.table_number + "...");
                    const { data, error } = await supabase.rpc("resolve_table_number", {
                      p_table_number: Number(table.table_number),
                    });
                    const qrToken = Array.isArray(data) ? data[0]?.qr_token : null;
                    if (error || !qrToken) {
                      setLoading(false);
                      setMessage("تعذر العثور على رابط هذه الطاولة. حدّث الصفحة وحاول مرة أخرى.");
                      return;
                    }
                    window.location.assign("/t/" + encodeURIComponent(String(qrToken)));
                  }}>
                  <strong>طاولة {table.table_number}</strong>
                  <span>{label}</span>
                  <small>{table.seats} مقاعد</small>
                </button>
              );
            })}
          </div>
          {!tableChoices.length && <p className="customer-table-picker-empty">لا توجد طاولات مسجلة حالياً.</p>}
        </section>
        <form className="customer-phone-form customer-qr-fallback" onSubmit={(event) => {
          event.preventDefault();
          const token = extractQrToken(qrInput);
          if (!token) { setMessage("رقم الطاولة غير صحيح. أدخل الرقم المكتوب على الطاولة أو امسح رمزها."); return; }
          setScannedQr(token);
          setLoading(true);
          setMessage("تم إدخال الرمز، جارٍ التحقق من توفر الطاولة...");
        }}>
          <label htmlFor="customer-qr-link">أدخل رقم الطاولة بدل المسح</label>
          <input id="customer-qr-link" dir="ltr" inputMode="url" placeholder="مثال: 4" value={qrInput} onChange={(event) => setQrInput(event.target.value)} />
          <button className="action-button" type="submit">التحقق من الطاولة <ArrowLeft size={17}/></button>
        </form>
        <small className="customer-privacy-note"><ShieldCheck size={15}/> لا يتم حجز الطاولة إلا بعد التحقق من حالتها. الحجز غير المستخدم ينتهي تلقائياً بعد 10 دقائق، وتتحرر الطاولة بعد إغلاق الحساب.</small>
      </main>
    );
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

      <section className="customer-visit-actions" aria-label="إدارة الزيارة">
        <div>
          <strong>{exitRequestedAt ? "طلب مغادرة الطاولة مسجل" : "إنهاء زيارتك"}</strong>
          <small>{exitRequestedAt
            ? "تم إبلاغ النادل. لن تُحرر الطاولة حتى تتم تسوية الحساب وإغلاق الجلسة."
            : "اطلب من النادل تسوية الحساب وتسجيل مغادرتك. لا تغلق الصفحة فقط."}</small>
        </div>
        <button type="button" className="action-button" disabled={busy || !!exitRequestedAt || !online || sessionStatus === "closed"} onClick={() => void requestCustomerExit()}>
          {busy ? "جارٍ التسجيل..." : exitRequestedAt ? "تم إرسال طلب المغادرة" : "طلب إنهاء الزيارة"}
        </button>
        <button type="button" className="action-button secondary" disabled={busy} onClick={() => void recordLogoutAndSignOut()}>
          تسجيل الخروج فقط
        </button>
      </section>

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
      {!online && <p className="offline-banner" role="status">لا يوجد اتصال، تظهر آخر حالة محفوظة وسيعاد الاتصال تلقائياً.</p>}\n      <section className="customer-service-panel" aria-label="طلبات الخدمة"><strong>تحتاج شيئاً على الطاولة؟</strong><div><button type="button" disabled={serviceBusy || !online} onClick={()=>void requestService("water")}>💧 ماء</button><button type="button" disabled={serviceBusy || !online} onClick={()=>void requestService("napkins")}>مناديل</button><button type="button" disabled={serviceBusy || !online} onClick={()=>void requestService("cutlery")}>أدوات طعام</button><button type="button" disabled={serviceBusy || !online} onClick={()=>void requestService("waiter")}>🔔 نادِل</button></div></section>\n      {coupons.length>0 && <section className="customer-coupons"><strong>عروض وكوبونات متاحة</strong>{coupons.map(c=><span key={c.id}>{c.title} · <b>{c.code}</b> · {c.discount_percent ? c.discount_percent+"%" : c.discount_amount+" ر.س"}</span>)}</section>}

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
                    <button className="action-button send-order" disabled={!quote || busy || !online || !!exitRequestedAt} onClick={() => void sendOrder()}>
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
                  if (!sessionId || !customerId) return;
                  setRefreshingOrders(true);
                  try { await refreshSession(sessionId, customerId); } finally { setRefreshingOrders(false); }
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
              <button className="bill-button orders-bill-button" disabled={busy || !!billRequest || !online || !orders.some((order) => order.session_id === sessionId)} onClick={() => void requestBill()}>{billRequest ? <><Check size={18}/> تم طلب الحساب</> : <>اطلب النادل للدفع <ArrowLeft size={17}/></>}</button>
            </section>
          )}
        </>
      )}
    </main>
  );
}
