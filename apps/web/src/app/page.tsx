import { PortalFrame } from "@restaurant/ui";
import { getSupabasePublicServerClient } from "@restaurant/db/public-server";
import { formatMoney } from "@restaurant/i18n";

export const revalidate = 60;

export default async function HomePage() {
  const db = getSupabasePublicServerClient();
  let name = "نكهة تجمعنا";
  let description = "طعام يُحضّر بعناية ولحظات تبقى في الذاكرة.";
  let featured: { id: string; name_ar: string; description_ar: string | null; price: number; image_path: string | null }[] = [];
  let contact: { phone: string | null; address: string | null } = { phone: null, address: null };

  if (db) {
    const [settings, products] = await Promise.all([
      db.from("settings").select("restaurant_name_ar,phone,address").eq("id",1).maybeSingle(),
      db.from("products").select("id,name_ar,description_ar,price,image_path")
        .eq("is_active",true).eq("is_available",true).eq("is_featured",true).order("sort_order").limit(6),
    ]);
    if (settings.data) {
      name = settings.data.restaurant_name_ar || name;
      contact = { phone: settings.data.phone, address: settings.data.address };
    }
    featured = (products.data ?? []) as typeof featured;
  }

  const baseUrl = process.env.NEXT_PUBLIC_CUSTOMER_APP_URL || "http://localhost:3001";
  return (
    <PortalFrame eyebrow="مطعم · ضيافة · مذاق" title={name} description={description}>
      <nav className="public-nav"><a href="/">الرئيسية</a><a href="/menu">القائمة</a><a href="/about">عن المطعم</a><a href="/location">الموقع والتواصل</a></nav>
      <section className="hero-panel">
        <div><span className="eyebrow">تجربة من أول لقمة</span><h2>طعام يُحضّر بعناية<br/>ولحظات تبقى في الذاكرة.</h2>
          <p>تصفح قائمتنا، واختر ما تحب، ثم امسح رمز الطاولة ليصل طلبك مباشرة إلى فريق المطعم.</p>
          <a className="action-button" href="/menu">اكتشف القائمة</a>
        </div>
        <div className="hero-art" aria-hidden="true">مذاق</div>
      </section>
      <section className="public-section">
        <header className="section-heading"><h2>الأكثر طلباً</h2><p>اختيارات من قائمتنا.</p></header>
        <div className="public-featured-grid">
          {featured.map((product) => {
            const image = product.image_path?.startsWith("http") ? product.image_path :
              product.image_path && db ? db.storage.from("product-images").getPublicUrl(product.image_path).data.publicUrl : null;
            return <article className="public-product" key={product.id}>
              {image ? <img src={image} alt={product.name_ar} loading="lazy"/> : <div className="placeholder">✦</div>}
              <div><h3>{product.name_ar}</h3>{product.description_ar && <p>{product.description_ar}</p>}<strong>{formatMoney(Number(product.price))}</strong></div>
            </article>;
          })}
          {!featured.length && <div className="empty-state">سيتم عرض الأطباق المميزة بعد اختيارها من لوحة المنيو.</div>}
        </div>
      </section>
      <section className="section-heading"><h2>كيف تطلب؟</h2><p>ثلاث خطوات بسيطة، وطلبك يصل إليك.</p></section>
      <div className="steps">
        <article><b>01</b><h3>امسح الرمز</h3><p>امسح QR الموجود على طاولتك.</p></article>
        <article><b>02</b><h3>اختر أطباقك</h3><p>تصفح القائمة وأرسل طلبك من جوالك.</p></article>
        <article><b>03</b><h3>استمتع بوقتك</h3><p>تابع حالة طلبك واطلب الحساب عند الانتهاء.</p></article>
      </div>
      <footer className="public-footer">
        <strong>{name}</strong>
        {contact.address && <p>{contact.address}</p>}
        {contact.phone && <p dir="ltr">{contact.phone}</p>}
        <a href={baseUrl}>افتح تطبيق الطلب</a>
      </footer>
    </PortalFrame>
  );
}
