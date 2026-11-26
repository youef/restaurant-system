"use client";

import { useState } from "react";
import { TableManager } from "./tables";
import { MenuManager } from "./menu";
import { StaffManager } from "./staff";
import { RestaurantSettings } from "./settings";
import { AdminOverview } from "./overview";
import { AdminReports } from "./reports";
import { AuditLog } from "./audit";

type Module = "overview" | "tables" | "menu" | "staff" | "reports" | "audit" | "settings";
const modules: { id: Module; title: string; icon: string }[] = [
  { id: "overview", title: "الرئيسية", icon: "⌂" },
  { id: "tables", title: "الطاولات", icon: "▦" },
  { id: "menu", title: "المنيو", icon: "☷" },
  { id: "staff", title: "الموظفون", icon: "♙" },
  { id: "reports", title: "التقارير", icon: "▤" },
  { id: "audit", title: "سجل العمليات", icon: "◷" },
  { id: "settings", title: "الإعدادات", icon: "⚙" },
];

export function AdminConsole() {
  const [active, setActive] = useState<Module>("overview");
  return (
    <main className="admin-console" dir="rtl">
      <aside className="admin-sidebar">
        <div className="admin-brand"><span>طَلَب</span><small>إدارة المطعم</small></div>
        <nav>
          {modules.map((module) => (
            <button key={module.id} className={active === module.id ? "active" : ""} onClick={() => setActive(module.id)}>
              <span aria-hidden="true">{module.icon}</span>{module.title}
            </button>
          ))}
        </nav>
        <footer><small>Restaurant Platform</small><span>وحدة التحكم</span></footer>
      </aside>
      <section className="admin-main">
        <header className="admin-topbar"><div><span className="eyebrow">لوحة التحكم</span><h1>{modules.find((module) => module.id === active)?.title}</h1></div><span className="admin-live">اتصال مباشر</span></header>
        {active === "overview" && <AdminOverview />}
        {active === "tables" && <TableManager />}
        {active === "menu" && <MenuManager />}
        {active === "staff" && <StaffManager />}
        {active === "reports" && <AdminReports />}
        {active === "audit" && <AuditLog />}
        {active === "settings" && <RestaurantSettings />}
      </section>
    </main>
  );
}
