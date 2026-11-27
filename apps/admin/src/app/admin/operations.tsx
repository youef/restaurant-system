"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@restaurant/db/client";

type Period = { start: string; end: string };
type Product = { id: string; name_ar: string };
type Waste = { id: string; product_name: string; quantity: number; unit: string; reason: string; recorded_at: string };
type Coupon = { id:string; code:string; title:string; discount_percent:number|null; discount_amount:number|null; is_active:boolean };
type Reward = { id:string; title:string; points_cost:number; is_active:boolean };
type Redemption = { id:string; reward_id:string; points_spent:number; redemption_code:string; status:string; created_at:string };
const periodLabels = { breakfast: "الإفطار", lunch: "الغداء", dinner: "العشاء" };
const reasonLabels: Record<string,string> = { spoiled: "تالف", returned: "مرتجع", preparation_error: "خطأ تحضير", expired: "منتهي الصلاحية", other: "أخرى" };

export function OperationsManager() {
  const db = getSupabaseBrowserClient();
  const [hours, setHours] = useState<Record<string,Period>>({
    breakfast:{start:"05:00",end:"11:00"}, lunch:{start:"11:00",end:"17:00"}, dinner:{start:"17:00",end:"05:00"}
  });
  const [rate,setRate] = useState("1");
  const [birthdayDiscount,setBirthdayDiscount]=useState("15");
  const [products,setProducts] = useState<Product[]>([]);
  const [waste,setWaste] = useState<Waste[]>([]);
  const [coupons,setCoupons]=useState<Coupon[]>([]);
  const [rewards,setRewards]=useState<Reward[]>([]);
  const [redemptions,setRedemptions]=useState<Redemption[]>([]);
  const [productId,setProductId] = useState("");
  const [quantity,setQuantity] = useState("1");
  const [unit,setUnit] = useState("حبة");
  const [reason,setReason] = useState("spoiled");
  const [notes,setNotes] = useState("");
  const [couponCode,setCouponCode] = useState("");
  const [couponTitle,setCouponTitle] = useState("");
  const [discount,setDiscount] = useState("10");
  const [discountType,setDiscountType] = useState<"percent"|"amount">("percent");
  const [rewardTitle,setRewardTitle] = useState("");
  const [rewardPoints,setRewardPoints] = useState("500");
  const [message,setMessage] = useState("");
  const [busy,setBusy] = useState(false);

  async function load() {
    const [settingsResult, productResult, wasteResult, couponResult, rewardResult, redemptionResult] = await Promise.all([
      db.from("settings").select("meal_period_hours,loyalty_points_per_currency,birthday_discount_percent").eq("id",1).maybeSingle(),
      db.from("products").select("id,name_ar").eq("is_active",true).order("name_ar"),
      db.from("waste_records").select("id,product_name,quantity,unit,reason,recorded_at").order("recorded_at",{ascending:false}).limit(100),
      db.from("coupons").select("id,code,title,discount_percent,discount_amount,is_active").order("created_at",{ascending:false}),
      db.from("loyalty_rewards").select("id,title,points_cost,is_active").order("points_cost"),
      db.from("loyalty_redemption_requests").select("id,reward_id,points_spent,redemption_code,status,created_at").eq("status","pending").order("created_at",{ascending:false})
    ]);
    if (settingsResult.data) {
      setHours({ ...hours, ...(settingsResult.data.meal_period_hours as Record<string,Period> ?? {}) });
      setRate(String(settingsResult.data.loyalty_points_per_currency ?? 1));
      setBirthdayDiscount(String(settingsResult.data.birthday_discount_percent ?? 15));
    }
    if (productResult.error) setMessage(productResult.error.message); else setProducts((productResult.data ?? []) as Product[]);
    if (wasteResult.error) setMessage(wasteResult.error.message); else setWaste((wasteResult.data ?? []) as Waste[]);
    if (couponResult.error) setMessage(couponResult.error.message); else setCoupons((couponResult.data ?? []) as Coupon[]);
    if (rewardResult.error) setMessage(rewardResult.error.message); else setRewards((rewardResult.data ?? []) as Reward[]);
    if (redemptionResult.error) setMessage(redemptionResult.error.message); else setRedemptions((redemptionResult.data ?? []) as Redemption[]);
  }
  useEffect(() => { void load(); }, []);

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const pointsRate=Number(rate), birthdayRate=Number(birthdayDiscount);
    if (!Number.isFinite(pointsRate) || pointsRate<0 || !Number.isFinite(birthdayRate) || birthdayRate<=0 || birthdayRate>100) { setMessage("تحقق من معدل النقاط ونسبة خصم الميلاد."); return; }
    setBusy(true);
    const {error}=await db.from("settings").update({meal_period_hours:hours,loyalty_points_per_currency:pointsRate,birthday_discount_percent:birthdayRate}).eq("id",1);
    setBusy(false); setMessage(error?.message ?? "تم حفظ أوقات الوجبات ومعدل النقاط.");
  }
  async function addWaste(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const product=products.find(p=>p.id===productId);
    const qty=Number(quantity);
    const {data:userData}=await db.auth.getUser();
    if (!product || !userData.user || !Number.isFinite(qty) || qty<=0) { setMessage("اختر الصنف وأدخل كمية صحيحة."); return; }
    setBusy(true);
    const {error}=await db.from("waste_records").insert({product_id:product.id,product_name:product.name_ar,quantity:qty,unit,reason,notes:notes.trim()||null,recorded_by:userData.user.id});
    setBusy(false);
    if(error) setMessage(error.message); else { setMessage("تم تسجيل الهدر."); setQuantity("1"); setNotes(""); await load(); }
  }
  async function addCoupon(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value=Number(discount);
    if (!couponCode.trim() || !couponTitle.trim() || !Number.isFinite(value) || value<=0 || (discountType==="percent" && value>100)) { setMessage("تحقق من بيانات الكوبون."); return; }
    setBusy(true);
    const {error}=await db.from("coupons").insert({code:couponCode.trim().toUpperCase(),title:couponTitle.trim(),discount_percent:discountType==="percent"?value:null,discount_amount:discountType==="amount"?value:null,is_active:true});
    setBusy(false);
    if(error) setMessage(error.message); else { setMessage("تم إنشاء الكوبون. سيظهر للعملاء ضمن العروض."); setCouponCode(""); setCouponTitle(""); await load(); }
  }
  async function toggleCoupon(coupon:Coupon) {
    setBusy(true);
    const {error}=await db.from("coupons").update({is_active:!coupon.is_active}).eq("id",coupon.id);
    setBusy(false);
    if(error) setMessage(error.message); else await load();
  }
  async function toggleReward(reward:Reward) {
    setBusy(true);
    const {error}=await db.from("loyalty_rewards").update({is_active:!reward.is_active}).eq("id",reward.id);
    setBusy(false);
    if(error) setMessage(error.message); else await load();
  }
  async function fulfillRedemption(item:Redemption) {
    const {data:userData}=await db.auth.getUser();
    if(!userData.user) {setMessage("تعذر تحديد الموظف الحالي.");return;}
    setBusy(true);
    const {error}=await db.from("loyalty_redemption_requests").update({status:"fulfilled",fulfilled_at:new Date().toISOString(),fulfilled_by:userData.user.id}).eq("id",item.id);
    setBusy(false);
    if(error) setMessage(error.message); else {setMessage("تم تأكيد تسليم المكافأة.");await load();}
  }
  async function addReward(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const points=Number(rewardPoints);
    if (!rewardTitle.trim() || !Number.isInteger(points) || points<=0) { setMessage("أدخل اسم المكافأة وعدد نقاط صحيحاً."); return; }
    setBusy(true);
    const {error}=await db.from("loyalty_rewards").insert({title:rewardTitle.trim(),points_cost:points,is_active:true});
    setBusy(false);
    setMessage(error?.message ?? "تمت إضافة المكافأة.");
    if(!error) { setRewardTitle(""); await load(); }
  }
  return <section className="admin-module" dir="rtl">
    <header className="module-heading"><div><span className="eyebrow">التشغيل والاحتفاظ بالعملاء</span><h2>الوجبات والولاء والهدر</h2><p>تحكم بأوقات عرض الوجبات، واكتساب النقاط، والعروض، وسجل الفاقد.</p></div></header>
    {message && <p className="feedback" role="status">{message}</p>}
    <form className="admin-panel" onSubmit={(e)=>void saveSettings(e)}>
      <header><h3>القائمة الذكية حسب الوقت</h3><span>حسب توقيت المطعم</span></header>
      <div className="admin-form-grid">
        {(["breakfast","lunch","dinner"] as const).map(key=><div key={key}><strong>{periodLabels[key]}</strong><label>من<input type="time" value={hours[key]?.start ?? "00:00"} onChange={e=>setHours(h=>({...h,[key]:{...h[key],start:e.target.value}}))}/></label><label>إلى<input type="time" value={hours[key]?.end ?? "00:00"} onChange={e=>setHours(h=>({...h,[key]:{...h[key],end:e.target.value}}))}/></label></div>)}
        <label>نقاط لكل ريال<input type="number" min="0" step="0.1" value={rate} onChange={e=>setRate(e.target.value)}/></label>
        <label>خصم عيد الميلاد (%)<input type="number" min="0.01" max="100" step="0.5" value={birthdayDiscount} onChange={e=>setBirthdayDiscount(e.target.value)}/></label>
      </div>
      <p className="muted">اربط كل منتج بفترة تقديمه من صفحة المنيو. المنتجات المحددة «كل الأوقات» تبقى ظاهرة دائماً.</p>
      <button className="action-button" disabled={busy}>حفظ الإعدادات</button>
    </form>
    <div className="admin-form-grid">
      <form className="admin-panel" onSubmit={e=>void addReward(e)}>
        <header><h3>مكافآت النقاط</h3></header>
        <label>اسم المكافأة<input value={rewardTitle} onChange={e=>setRewardTitle(e.target.value)} placeholder="مثلاً: مشروب مجاني" required/></label>
        <label>تكلفة النقاط<input type="number" min="1" value={rewardPoints} onChange={e=>setRewardPoints(e.target.value)} required/></label>
        <button className="action-button" disabled={busy}>إضافة مكافأة</button>
      </form>
      <form className="admin-panel" onSubmit={e=>void addCoupon(e)}>
        <header><h3>كوبون وعرض جديد</h3></header>
        <label>رمز الكوبون<input value={couponCode} onChange={e=>setCouponCode(e.target.value)} placeholder="WELCOME10" required/></label>
        <label>عنوان العرض<input value={couponTitle} onChange={e=>setCouponTitle(e.target.value)} required/></label>
        <label>نوع الخصم<select value={discountType} onChange={e=>setDiscountType(e.target.value as "percent"|"amount")}><option value="percent">نسبة مئوية</option><option value="amount">مبلغ بالريال</option></select></label>
        <label>قيمة الخصم<input type="number" min="0.01" max={discountType==="percent"?100:undefined} step="0.01" value={discount} onChange={e=>setDiscount(e.target.value)} required/></label>
        <button className="action-button" disabled={busy}>إنشاء الكوبون</button>
      </form>
    </div>
    <section className="admin-panel">
      <header><h3>إدارة الكوبونات والمكافآت</h3><span>{coupons.length} كوبون · {rewards.length} مكافأة</span></header>
      <div className="admin-form-grid">
        <div><h4>الكوبونات</h4>{coupons.map(coupon=><p key={coupon.id}>{coupon.title} · {coupon.code} · {coupon.discount_percent ? coupon.discount_percent+"%" : coupon.discount_amount+" ر.س"} <button type="button" className="small-action" disabled={busy} onClick={()=>void toggleCoupon(coupon)}>{coupon.is_active?"إيقاف":"تفعيل"}</button></p>)}</div>
        <div><h4>المكافآت</h4>{rewards.map(reward=><p key={reward.id}>{reward.title} · {reward.points_cost} نقطة <button type="button" className="small-action" disabled={busy} onClick={()=>void toggleReward(reward)}>{reward.is_active?"إيقاف":"تفعيل"}</button></p>)}</div>
      </div>
    </section>
    <section className="admin-panel">
      <header><h3>طلبات استبدال النقاط</h3><span>{redemptions.length} بانتظار التسليم</span></header>
      {redemptions.map(item=><article className="waiter-task-card" key={item.id}><div><strong>{rewards.find(reward=>reward.id===item.reward_id)?.title ?? "مكافأة"}</strong><p>{item.points_spent} نقطة</p><small>رمز الاستبدال: {item.redemption_code} · {new Date(item.created_at).toLocaleString("ar-SA")}</small></div><button type="button" className="action-button" disabled={busy} onClick={()=>void fulfillRedemption(item)}>تأكيد التسليم</button></article>)}
      {!redemptions.length&&<p className="muted">لا توجد مكافآت بانتظار التسليم.</p>}
    </section>
    <form className="admin-panel" onSubmit={e=>void addWaste(e)}>
      <header><h3>تسجيل الهدر والتالف والمرتجع</h3><span>سجل تشغيلي</span></header>
      <div className="admin-form-grid">
        <label>الصنف<select value={productId} onChange={e=>setProductId(e.target.value)} required><option value="">اختر صنفاً</option>{products.map(p=><option key={p.id} value={p.id}>{p.name_ar}</option>)}</select></label>
        <label>الكمية<input type="number" min="0.001" step="0.001" value={quantity} onChange={e=>setQuantity(e.target.value)} required/></label>
        <label>الوحدة<input value={unit} onChange={e=>setUnit(e.target.value)} required/></label>
        <label>السبب<select value={reason} onChange={e=>setReason(e.target.value)}><option value="spoiled">تالف</option><option value="returned">مرتجع</option><option value="preparation_error">خطأ تحضير</option><option value="expired">منتهي الصلاحية</option><option value="other">أخرى</option></select></label>
        <label className="wide-field">ملاحظات<textarea value={notes} onChange={e=>setNotes(e.target.value)} maxLength={500}/></label>
      </div>
      <button className="action-button" disabled={busy}>تسجيل الهدر</button>
    </form>
    <section className="admin-panel"><header><h3>سجل الهدر الأخير</h3><span>{waste.length} سجل</span></header>
      <div className="table-scroll"><table className="admin-table"><thead><tr><th>الصنف</th><th>الكمية</th><th>السبب</th><th>التاريخ</th></tr></thead>
      <tbody>{waste.map(w=><tr key={w.id}><td>{w.product_name}</td><td>{w.quantity} {w.unit}</td><td>{reasonLabels[w.reason]??w.reason}</td><td>{new Date(w.recorded_at).toLocaleString("ar-SA")}</td></tr>)}</tbody></table>{!waste.length&&<p className="muted">لا توجد سجلات بعد.</p>}</div>
    </section>
  </section>;
}
