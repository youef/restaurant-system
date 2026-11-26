"use client";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@restaurant/db/client";
import { useRealtimeRefresh } from "@restaurant/realtime";

type Log = { id: number; actor_id: string | null; action: string; entity: string; entity_id: string | null; meta: Record<string,unknown> | null; created_at: string };
type Profile = { id: string; full_name: string | null };
const actionLabels: Record<string,string> = { status_changed:"تغيير حالة", staff_invited:"دعوة موظف", staff_updated:"تحديث موظف" };

export function AuditLog() {
  const [logs,setLogs] = useState<Log[]>([]);
  const [profiles,setProfiles] = useState<Map<string,string>>(new Map());
  const [filter,setFilter] = useState("");
  const [message,setMessage] = useState("");
  const revision = useRealtimeRefresh("audit_logs");
  useEffect(() => {
    let active = true;
    async function load() {
      const { data,error } = await getSupabaseBrowserClient().from("audit_logs")
        .select("id,actor_id,action,entity,entity_id,meta,created_at")
        .order("created_at",{ascending:false}).limit(200);
      if(error){setMessage(error.message);return;}
      if(!active)return;
      const rows = (data ?? []) as Log[];
      setLogs(rows);
      const ids = [...new Set(rows.map((row)=>row.actor_id).filter((id):id is string=>!!id))];
      if(ids.length){
        const {data:profileRows} = await getSupabaseBrowserClient().from("profiles").select("id,full_name").in("id",ids);
        if(active)setProfiles(new Map(((profileRows??[]) as Profile[]).map((profile)=>[profile.id,profile.full_name??profile.id])));
      }else if(active)setProfiles(new Map());
    }
    void load(); return ()=>{active=false;};
  },[revision]);
  const visible = logs.filter((log) => {
    const actor = log.actor_id ? profiles.get(log.actor_id) ?? "" : "";
    const text = [log.action,log.entity,log.entity_id ?? "",actor,JSON.stringify(log.meta ?? {})].join(" ").toLowerCase();
    return !filter.trim() || text.includes(filter.toLowerCase());
  });
  return <section className="admin-module" dir="rtl">
    <header className="module-heading"><div><span className="eyebrow">المراجعة والتدقيق</span><h2>سجل العمليات</h2><p>آخر 200 عملية مسجلة.</p></div><strong>{logs.length} سجل</strong></header>
    <input className="audit-search" type="search" placeholder="ابحث باسم الموظف أو العملية..." value={filter} onChange={(event)=>setFilter(event.target.value)} />
    {message&&<p className="feedback" role="alert">{message}</p>}
    <div className="table-scroll"><table className="admin-table"><thead><tr><th>التاريخ</th><th>الموظف</th><th>العملية</th><th>الكيان</th><th>رقم السجل</th><th>التفاصيل</th></tr></thead>
      <tbody>{visible.map((log)=><tr key={log.id}><td>{new Date(log.created_at).toLocaleString("ar-SA")}</td><td>{log.actor_id?profiles.get(log.actor_id)??"موظف":"النظام"}</td><td>{actionLabels[log.action]??log.action}</td><td>{log.entity}</td><td>{log.entity_id??"—"}</td><td><code>{JSON.stringify(log.meta??{})}</code></td></tr>)}</tbody>
    </table></div>
    {!visible.length&&<div className="empty-state">لا توجد عمليات تطابق البحث.</div>}
  </section>;
}
