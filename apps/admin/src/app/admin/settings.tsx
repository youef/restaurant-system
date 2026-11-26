"use client";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@restaurant/db/client";

type Settings = {
  restaurant_name_ar: string; restaurant_name_en: string | null; vat_rate: number;
  currency: string; timezone: string; phone: string | null; address: string | null;
  opening_hours: Record<string, string>; default_language: string; customer_app_url: string | null;
};
const days = [["sat","السبت"],["sun","الأحد"],["mon","الإثنين"],["tue","الثلاثاء"],["wed","الأربعاء"],["thu","الخميس"],["fri","الجمعة"]];

export function RestaurantSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    async function load() {
      const { data, error } = await getSupabaseBrowserClient().from("settings")
        .select("restaurant_name_ar,restaurant_name_en,vat_rate,currency,timezone,phone,address,opening_hours,default_language,customer_app_url")
        .eq("id", 1).maybeSingle();
      if (error) setMessage(error.message);
      else if (data) setSettings({ ...data, opening_hours: (data.opening_hours ?? {}) as Record<string,string>, vat_rate: Number(data.vat_rate) } as Settings);
      else setMessage("لم يتم العثور على إعدادات المطعم.");
    }
    void load();
  }, []);
  function change<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((current) => current ? { ...current, [key]: value } : current);
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    const vat = Number(settings.vat_rate);
    if (!Number.isFinite(vat) || vat < 0 || vat > 1) { setMessage("نسبة الضريبة يجب أن تكون بين 0 و100%."); return; }
    setBusy(true);
    const { error } = await getSupabaseBrowserClient().from("settings").update({
      restaurant_name_ar: settings.restaurant_name_ar.trim(),
      restaurant_name_en: settings.restaurant_name_en?.trim() || null,
      vat_rate: vat, phone: settings.phone?.trim() || null, address: settings.address?.trim() || null,
      default_language: settings.default_language,
      customer_app_url: settings.customer_app_url?.trim().replace(/\/+$/, "") || null,
      opening_hours: settings.opening_hours,
    }).eq("id", 1);
    setBusy(false);
    setMessage(error?.message ?? "تم حفظ إعدادات المطعم.");
  }
  if (!settings) return <section className="admin-module"><div className="empty-state">{message || "جارٍ تحميل الإعدادات..."}</div></section>;
  return <section className="admin-module" dir="rtl">
    <header className="module-heading"><div><span className="eyebrow">الهوية والتشغيل</span><h2>إعدادات المطعم</h2><p>اسم المطعم والضريبة وساعات الدوام ورابط تطبيق العميل.</p></div></header>
    <form className="admin-settings-form" onSubmit={(event) => void save(event)}>
      <div className="admin-form-grid">
        <label>اسم المطعم بالعربية<input value={settings.restaurant_name_ar} onChange={(event) => change("restaurant_name_ar", event.target.value)} required /></label>
        <label>اسم المطعم بالإنجليزية<input dir="ltr" value={settings.restaurant_name_en ?? ""} onChange={(event) => change("restaurant_name_en", event.target.value)} /></label>
        <label>رقم الهاتف<input dir="ltr" type="tel" value={settings.phone ?? ""} onChange={(event) => change("phone", event.target.value)} /></label>
        <label>العنوان<input value={settings.address ?? ""} onChange={(event) => change("address", event.target.value)} /></label>
        <label>ضريبة القيمة المضافة (%)<input type="number" min="0" max="100" step="0.01" value={(settings.vat_rate * 100).toString()} onChange={(event) => change("vat_rate", Number(event.target.value) / 100)} required /></label>
        <label>اللغة الافتراضية<select value={settings.default_language} onChange={(event) => change("default_language", event.target.value)}><option value="ar">العربية</option><option value="en">English</option></select></label>
        <label className="wide-field">رابط تطبيق العميل (يستخدم في QR)<input dir="ltr" type="url" placeholder="https://order.example.com" value={settings.customer_app_url ?? ""} onChange={(event) => change("customer_app_url", event.target.value)} /><small>في التطوير المحلي: http://localhost:3001</small></label>
      </div>
      <section className="opening-hours-panel"><h3>ساعات العمل</h3><div className="opening-hours-grid">
        {days.map(([key,label]) => <label key={key}>{label}<input value={settings.opening_hours[key] ?? ""} onChange={(event) => change("opening_hours", { ...settings.opening_hours, [key]: event.target.value })} placeholder="09:00 - 23:00 أو مغلق" /></label>)}
      </div></section>
      <button className="action-button" disabled={busy}>{busy ? "جارٍ الحفظ..." : "حفظ الإعدادات"}</button>
      {message && <p className="feedback" role="status">{message}</p>}
    </form>
  </section>;
}
