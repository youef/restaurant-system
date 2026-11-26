import { PortalFrame } from "@restaurant/ui";
import { getSupabasePublicServerClient } from "@restaurant/db/public-server";
import { formatMoney } from "@restaurant/i18n";

export const revalidate = 60;

export default async function MenuPage() {
  const db = getSupabasePublicServerClient();
  let categories: { id:string; name_ar:string; sort_order:number }[] = [];
  let products: { id:string; category_id:string; name_ar:string; description_ar:string|null; price:number; image_path:string|null; is_available:boolean }[] = [];
  if (db) {
    const [categoryResult, productResult] = await Promise.all([
      db.from("categories").select("id,name_ar,sort_order").eq("is_active",true).order("sort_order"),
      db.from("products").select("id,category_id,name_ar,description_ar,price,image_path,is_available,sort_order").eq("is_active",true).order("sort_order"),
    ]);
    categories = (categoryResult.data ?? []) as typeof categories;
    products = (productResult.data ?? []) as typeof products;
  }
  return (
    <PortalFrame eyebrow="MENU" title="قائمتنا" description="تعرّف على الأطباق المتاحة. لإرسال طلبك امسح QR الطاولة داخل المطعم.">
      <nav className="public-nav"><a href="/">الرئيسية</a><a href="/about">عن المطعم</a><a href="/location">الموقع والتواصل</a></nav>
      {categories.map((category) => (
        <section className="public-menu-category" key={category.id}>
          <h2>{category.name_ar}</h2>
          <div className="public-featured-grid">
            {products.filter((product) => product.category_id === category.id).map((product) => {
              const image = product.image_path?.startsWith("http") ? product.image_path :
                product.image_path && db ? db.storage.from("product-images").getPublicUrl(product.image_path).data.publicUrl : null;
              return <article className="public-product" key={product.id}>
                {image ? <img src={image} alt={product.name_ar} loading="lazy"/> : <div className="placeholder">✦</div>}
                <div><h3>{product.name_ar}</h3>{product.description_ar && <p>{product.description_ar}</p>}
                  <strong>{formatMoney(Number(product.price))}</strong>
                  {!product.is_available && <span className="unavailable-chip">غير متوفر حالياً</span>}
                </div>
              </article>;
            })}
          </div>
        </section>
      ))}
      {!categories.length && <div className="empty-state">لم تتم إضافة فئات للمنيو بعد.</div>}
    </PortalFrame>
  );
}
