import { PortalFrame } from "@restaurant/ui";
import { getSupabasePublicServerClient } from "@restaurant/db/public-server";
export const revalidate = 60;
export default async function AboutPage() {
  const db=getSupabasePublicServerClient();
  const {data}=db?await db.from("settings").select("restaurant_name_ar,restaurant_name_en,address,phone").eq("id",1).maybeSingle():{data:null};
  return <PortalFrame eyebrow="ABOUT" title={"عن "+(data?.restaurant_name_ar||"مطعمنا")} description="نؤمن أن الطعام الجيد يبدأ من العناية بالتفاصيل وينتهي بتجربة ضيافة تليق بكم.">
    <section className="hero-panel"><div><h2>ضيافة قريبة من القلب.</h2><p>نحرص على اختيار الأطباق بعناية وتقديمها في أجواء مريحة. نسعد بزيارتكم دائماً.</p><a className="action-button" href="/menu">تصفح القائمة</a></div><div className="hero-art">أهلاً وسهلاً</div></section>
  </PortalFrame>;
}
