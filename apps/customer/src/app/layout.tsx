import type {Metadata} from "next";
import type {ReactNode} from "react";
import {ServiceWorkerRegister} from "./service-worker-register";
import "./globals.css";

export const metadata:Metadata={
  title:"قائمة الطعام | مطعمك",
  description:"استعرض قائمة الطعام، أضف طلبك، وتابع تحضيره مباشرة من طاولتك.",
  manifest:"/manifest.webmanifest",
  icons:{icon:"/icon.svg",apple:"/icon.svg"},
};
export const viewport = { themeColor: "#FF6B4A", width: "device-width", initialScale: 1, viewportFit: "cover" };
export default function Layout({children}:{children:ReactNode}){
  return <html lang="ar" dir="rtl"><body><ServiceWorkerRegister/>{children}</body></html>;
}
