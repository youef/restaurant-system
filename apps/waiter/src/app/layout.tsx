import type {Metadata} from "next";
import type {ReactNode} from "react";
import {ServiceWorkerRegister} from "./service-worker-register";
import "./globals.css";

export const metadata:Metadata={
  title:"مهام النادل | منصة الطلب",
  description:"استلام طلبات الحساب وتقديم الطلبات الجاهزة.",
  manifest:"/manifest.webmanifest",
  themeColor:"#1B2A41",
  icons:{icon:"/icon.svg",apple:"/icon.svg"},
};
export default function Layout({children}:{children:ReactNode}){
  return <html lang="ar" dir="rtl"><body><ServiceWorkerRegister/>{children}</body></html>;
}
