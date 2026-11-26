import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: { default: "مطعمك يبدأ من هنا | منصة الطلب", template: "%s | مطعمك" },
  description: "اكتشف قائمة المطعم واطلب مباشرة من طاولتك.",
  openGraph: {
    type: "website",
    locale: "ar_SA",
    title: "مطعمك يبدأ من هنا",
    description: "قائمة المطعم وتجربة الطلب من الطاولة.",
    url: baseUrl,
    siteName: "مطعمك",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="ar" dir="rtl"><body>{children}</body></html>;
}
