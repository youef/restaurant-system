import { PortalFrame } from "@restaurant/ui";
import { getSupabasePublicServerClient } from "@restaurant/db/public-server";
export const revalidate = 60;
export default async function LocationPage() {
  const db=getSupabasePublicServerClient();
  const {data}=db?await db.from("settings").select("restaurant_name_ar,address,phone,opening_hours").eq("id",1).maybeSingle():{data:null};
  const hours=(data?.opening_hours??{}) as Record<string,string>;
  const days:[string,string][]=[["sat","السبت"],["sun","الأحد"],["mon","الإثنين"],["tue","الثلاثاء"],["wed","الأربعاء"],["thu","الخميس"],["fri","الجمعة"]];
  return <PortalFrame eyebrow="VISIT US" title="الموقع والتواصل" description="يسعدنا استقبالكم ومساعدتكم.">
    <div className="public-contact">
      <article><h2>العنوان</h2><p>{data?.address||"يمكن إضافة العنوان من إعدادات لوحة الإدارة."}</p></article>
      <article><h2>التواصل</h2><p dir="ltr">{data?.phone||"—"}</p></article>
    </div>
    <section className="admin-panel"><h2>ساعات الدوام</h2>{days.map(([key,label])=><div className="session-account" key={key}><strong>{label}</strong><span>{hours[key]||"لم تحدد"}</span></div>)}</section>
  </PortalFrame>;
}
