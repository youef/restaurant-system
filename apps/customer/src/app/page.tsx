export default function Home(){
  return (
    <main className="customer-landing" dir="rtl">
      <span className="eyebrow">أهلاً بك</span>
      <h1>زيارتك تبدأ<br/><em>من جوالك.</em></h1>
      <p>ابدأ بإدخال رقم جوالك وسنة ميلادك الهجرية لربط طلباتك وفواتيرك، ثم امسح رمز QR الموجود على طاولتك لفتح القائمة.</p>
      <a className="customer-start-button" href="/t/start">ابدأ الآن <span aria-hidden="true">←</span></a>
      <div className="notice">اطلب بنفسك وتابع اعتماد الطلب وتحضيره وتجهيزه حتى يصل إليك.</div>
    </main>
  );
}
