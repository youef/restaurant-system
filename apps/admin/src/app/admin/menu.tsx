"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@restaurant/db/client";
import { formatMoney } from "@restaurant/i18n";

type Category = { id: string; name_ar: string; name_en: string | null; sort_order: number; is_active: boolean };
type Product = {
  id: string; category_id: string; name_ar: string; name_en: string | null;
  description_ar: string | null; description_en: string | null; price: number;
  image_path: string | null; station: "kitchen" | "grill" | "bar" | "dessert";
  is_available: boolean; is_active: boolean; is_featured: boolean; sort_order: number;
};
type ProductDraft = {
  id?: string; category_id: string; name_ar: string; name_en: string; description_ar: string;
  description_en: string; price: string; station: Product["station"]; is_available: boolean;
  is_active: boolean; is_featured: boolean; sort_order: string; image_path: string | null;
};

const emptyDraft: ProductDraft = {
  category_id: "", name_ar: "", name_en: "", description_ar: "", description_en: "",
  price: "", station: "kitchen", is_available: true, is_active: true,
  is_featured: false, sort_order: "0", image_path: null,
};

export function MenuManager() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft);
  const [categoryName, setCategoryName] = useState("");
  const [categoryEnglish, setCategoryEnglish] = useState("");
  const [editing, setEditing] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const db = getSupabaseBrowserClient();
    const [cat, prod] = await Promise.all([
      db.from("categories").select("id,name_ar,name_en,sort_order,is_active").order("sort_order"),
      db.from("products").select("id,category_id,name_ar,name_en,description_ar,description_en,price,image_path,station,is_available,is_active,is_featured,sort_order").order("sort_order"),
    ]);
    if (cat.error) setMessage(cat.error.message); else setCategories((cat.data ?? []) as Category[]);
    if (prod.error) setMessage(prod.error.message); else setProducts((prod.data ?? []) as Product[]);
  }
  useEffect(() => { void load(); }, []);

  function editProduct(product?: Product) {
    setSelectedFile(null);
    if (!product) {
      setDraft({ ...emptyDraft, category_id: categories[0]?.id ?? "" });
      setEditing(true);
      return;
    }
    setDraft({
      id: product.id, category_id: product.category_id, name_ar: product.name_ar,
      name_en: product.name_en ?? "", description_ar: product.description_ar ?? "",
      description_en: product.description_en ?? "", price: String(product.price),
      station: product.station, is_available: product.is_available, is_active: product.is_active,
      is_featured: product.is_featured, sort_order: String(product.sort_order),
      image_path: product.image_path,
    });
    setEditing(true);
  }

  async function addCategory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!categoryName.trim()) return;
    const { error } = await getSupabaseBrowserClient().from("categories").insert({
      name_ar: categoryName.trim(), name_en: categoryEnglish.trim() || null,
      sort_order: categories.length + 1, is_active: true,
    });
    if (error) setMessage(error.message);
    else {
      setCategoryName(""); setCategoryEnglish(""); setMessage("تمت إضافة الفئة.");
      await load();
    }
  }

  async function toggleCategory(category: Category) {
    const { error } = await getSupabaseBrowserClient().from("categories")
      .update({ is_active: !category.is_active }).eq("id", category.id);
    if (error) setMessage(error.message); else await load();
  }

  async function saveProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const price = Number(draft.price);
    if (!draft.category_id || !draft.name_ar.trim() || !Number.isFinite(price) || price < 0) {
      setMessage("أدخل الفئة والاسم العربي وسعراً صحيحاً.");
      return;
    }
    setBusy(true);
    const db = getSupabaseBrowserClient();
    let imagePath = draft.image_path;
    if (selectedFile) {
      const safeName = selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-80);
      const path = "products/" + crypto.randomUUID() + "-" + safeName;
      const { error: uploadError } = await db.storage.from("product-images").upload(path, selectedFile, {
        contentType: selectedFile.type || "application/octet-stream",
        upsert: false,
      });
      if (uploadError) {
        setBusy(false); setMessage(uploadError.message); return;
      }
      imagePath = path;
    }

    const payload = {
      category_id: draft.category_id, name_ar: draft.name_ar.trim(),
      name_en: draft.name_en.trim() || null,
      description_ar: draft.description_ar.trim() || null,
      description_en: draft.description_en.trim() || null,
      price, image_path: imagePath, station: draft.station,
      is_available: draft.is_available, is_active: draft.is_active,
      is_featured: draft.is_featured, sort_order: Number(draft.sort_order) || 0,
    };
    const result = draft.id
      ? await db.from("products").update(payload).eq("id", draft.id)
      : await db.from("products").insert(payload);
    setBusy(false);
    if (result.error) setMessage(result.error.message);
    else {
      setMessage("تم حفظ المنتج.");
      setEditing(false); setSelectedFile(null); setDraft(emptyDraft);
      await load();
    }
  }

  async function toggleAvailability(product: Product) {
    const { error } = await getSupabaseBrowserClient().from("products")
      .update({ is_available: !product.is_available }).eq("id", product.id);
    if (error) setMessage(error.message); else await load();
  }

  async function toggleActive(product: Product) {
    const { error } = await getSupabaseBrowserClient().from("products")
      .update({ is_active: !product.is_active }).eq("id", product.id);
    if (error) setMessage(error.message); else await load();
  }

  const activeCategories = categories.filter((category) => category.is_active);
  return (
    <section className="admin-module" dir="rtl">
      <header className="module-heading"><div><span className="eyebrow">المنيو</span><h2>الفئات والمنتجات</h2><p>أضف الأصناف وعدّل السعر والصورة ومحطة التحضير والتوفر.</p></div><button className="action-button" onClick={() => editProduct()}>إضافة منتج</button></header>
      {message && <p className="feedback" role="status">{message}</p>}

      <form className="category-create" onSubmit={(event) => void addCategory(event)}>
        <h3>إضافة فئة</h3>
        <input placeholder="اسم الفئة بالعربية" value={categoryName} onChange={(event) => setCategoryName(event.target.value)} required />
        <input placeholder="English name" value={categoryEnglish} onChange={(event) => setCategoryEnglish(event.target.value)} />
        <button className="action-button">إضافة فئة</button>
      </form>
      <div className="category-admin-list">
        {categories.map((category) => (
          <article key={category.id} className="category-admin-chip">
            <strong>{category.name_ar}</strong><small>{category.name_en}</small>
            <span className={category.is_active ? "state-pill active" : "state-pill inactive"}>{category.is_active ? "مفعلة" : "معطلة"}</span>
            <button className="small-action" onClick={() => void toggleCategory(category)}>{category.is_active ? "تعطيل" : "تفعيل"}</button>
          </article>
        ))}
      </div>

      <div className="admin-product-grid">
        {products.map((product) => (
          <article className="admin-product-card" key={product.id}>
            <div className="admin-product-head"><strong>{product.name_ar}</strong><span>{formatMoney(Number(product.price))}</span></div>
            <small>{categories.find((category) => category.id === product.category_id)?.name_ar ?? "—"} · {product.station}</small>
            <p>{product.description_ar}</p>
            <div className="product-flags">
              <span className={product.is_available ? "state-pill active" : "state-pill inactive"}>{product.is_available ? "متوفر" : "نفد"}</span>
              <span className={product.is_active ? "state-pill active" : "state-pill inactive"}>{product.is_active ? "ظاهر" : "مخفي"}</span>
              {product.is_featured && <span className="state-pill featured">مميز</span>}
            </div>
            <footer>
              <button className="small-action" onClick={() => editProduct(product)}>تعديل</button>
              <button className="small-action" onClick={() => void toggleAvailability(product)}>{product.is_available ? "تحديد نفد" : "إعادة التوفر"}</button>
              <button className="small-action" onClick={() => void toggleActive(product)}>{product.is_active ? "إخفاء" : "إظهار"}</button>
            </footer>
          </article>
        ))}
      </div>

      {editing && (
        <div className="sheet-backdrop" role="presentation" onClick={() => setEditing(false)}>
          <form className="admin-edit-sheet" onSubmit={(event) => void saveProduct(event)} onClick={(event) => event.stopPropagation()}>
            <header><h2>{draft.id ? "تعديل المنتج" : "منتج جديد"}</h2><button type="button" className="close-button" onClick={() => setEditing(false)}>إغلاق</button></header>
            <div className="admin-form-grid">
              <label>الفئة<select value={draft.category_id} onChange={(event) => setDraft({ ...draft, category_id: event.target.value })} required>
                <option value="">اختر فئة</option>{activeCategories.map((category) => <option key={category.id} value={category.id}>{category.name_ar}</option>)}
              </select></label>
              <label>الاسم بالعربية<input value={draft.name_ar} onChange={(event) => setDraft({ ...draft, name_ar: event.target.value })} required maxLength={120} /></label>
              <label>English name<input dir="ltr" value={draft.name_en} onChange={(event) => setDraft({ ...draft, name_en: event.target.value })} /></label>
              <label>السعر (ريال)<input type="number" min="0" step="0.01" value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} required /></label>
              <label>محطة التحضير<select value={draft.station} onChange={(event) => setDraft({ ...draft, station: event.target.value as Product["station"] })}>
                <option value="kitchen">المطبخ</option><option value="grill">الشواية</option><option value="bar">البار</option><option value="dessert">الحلويات</option>
              </select></label>
              <label>ترتيب العرض<input type="number" value={draft.sort_order} onChange={(event) => setDraft({ ...draft, sort_order: event.target.value })} /></label>
              <label className="wide-field">الوصف بالعربية<textarea value={draft.description_ar} onChange={(event) => setDraft({ ...draft, description_ar: event.target.value })} rows={2} /></label>
              <label className="wide-field">English description<textarea dir="ltr" value={draft.description_en} onChange={(event) => setDraft({ ...draft, description_en: event.target.value })} rows={2} /></label>
              <label className="wide-field">صورة المنتج<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} /></label>
              <label><input type="checkbox" checked={draft.is_available} onChange={(event) => setDraft({ ...draft, is_available: event.target.checked })} /> متوفر للطلب</label>
              <label><input type="checkbox" checked={draft.is_active} onChange={(event) => setDraft({ ...draft, is_active: event.target.checked })} /> ظاهر في المنيو</label>
              <label><input type="checkbox" checked={draft.is_featured} onChange={(event) => setDraft({ ...draft, is_featured: event.target.checked })} /> منتج مميز</label>
            </div>
            <button className="action-button" disabled={busy}>{busy ? "جارٍ الحفظ..." : "حفظ المنتج"}</button>
          </form>
        </div>
      )}
    </section>
  );
}
