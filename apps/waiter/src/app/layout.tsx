import type {Metadata, Viewport} from "next";
import type {ReactNode} from "react";
import {ServiceWorkerRegister} from "./service-worker-register";
import "./globals.css";
import {StaffInteractionGuard} from "./staff-interaction-guard";

export const viewport:Viewport={width:"device-width",initialScale:1,maximumScale:1,userScalable:false,viewportFit:"cover",themeColor:"#1B2A41"};
export const metadata:Metadata={
  title:"مهام النادل | منصة الطلب",
  description:"استلام طلبات الحساب وتقديم الطلبات الجاهزة.",
  manifest:"/manifest.webmanifest",
  icons:{icon:"/icon.svg",apple:"/icon.svg"},
};
export default function Layout({children}:{children:ReactNode}){
  return <html lang="ar" dir="rtl"><body><StaffInteractionGuard/><ServiceWorkerRegister/>{children}</body></html>;
}
