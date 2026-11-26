import type {Metadata} from "next";
import type {ReactNode} from "react";
import {ServiceWorkerRegister} from "./service-worker-register";
import "./globals.css";

export const metadata:Metadata={
  title:"طلبك على راحتك | منصة الطلب",
  description:"اطلب من طاولتك وتابع حالة طلبك مباشرة.",
  manifest:"/manifest.webmanifest",
  themeColor:"#FF6B4A",
  icons:{icon:"/icon.svg",apple:"/icon.svg"},
};
export default function Layout({children}:{children:ReactNode}){
  return <html lang="ar" dir="rtl"><body><ServiceWorkerRegister/>{children}</body></html>;
}
