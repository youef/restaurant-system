"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@restaurant/db/client";

type StaffRole = "cashier" | "kitchen" | "waiter" | "admin";
type Staff = {
  id: string; full_name: string | null; role: StaffRole; is_active: boolean;
  email: string; created_at: string; last_sign_in_at: string | null;
};

const roleLabels: Record<StaffRole, string> = {
  cashier: "كاشير", kitchen: "مطبخ", waiter: "نادل", admin: "مدير",
};

export function StaffManager() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<StaffRole>("cashier");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await getSupabaseBrowserClient().functions.invoke("manage-staff", {
      body: { action: "list" },
    });
    if (error) setMessage(error.message);
    else setStaff((data?.staff ?? []) as Staff[]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const { data, error } = await getSupabaseBrowserClient().functions.invoke("manage-staff", {
      body: { action: "invite", email, full_name: fullName, role },
    });
    setBusy(false);
    if (error || data?.error) {
      setMessage(data?.error ?? error?.message ?? "تعذر إرسال الدعوة.");
      return;
    }
    setMessage(data?.message ?? "تم إرسال الدعوة.");
    setEmail("");
    setFullName("");
    await load();
  }

  async function updateMember(member: Staff, patch: { role?: StaffRole; is_active?: boolean }) {
    setMessage("");
    const { data, error } = await getSupabaseBrowserClient().functions.invoke("manage-staff", {
      body: { action: "update", user_id: member.id, ...patch },
    });
    if (error || data?.error) setMessage(data?.error ?? error?.message ?? "تعذر تحديث الموظف.");
    else {
      setMessage(data?.message ?? "تم التحديث.");
      await load();
    }
  }

  return (
    <section className="admin-module" dir="rtl">
      <header className="module-heading"><div><span className="eyebrow">الفريق</span><h2>إدارة الموظفين</h2><p>دعوة الموظفين بالبريد وتحديد الدور أو إيقاف صلاحية الدخول.</p></div><strong>{staff.length} موظف</strong></header>
      <form className="admin-form staff-invite-form" onSubmit={(event) => void invite(event)}>
        <label>اسم الموظف<input value={fullName} onChange={(event) => setFullName(event.target.value)} required maxLength={120} /></label>
        <label>البريد الإلكتروني<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>الدور<select value={role} onChange={(event) => setRole(event.target.value as StaffRole)}><option value="cashier">كاشير</option><option value="kitchen">مطبخ</option><option value="waiter">نادل</option><option value="admin">مدير</option></select></label>
        <button className="action-button" disabled={busy}>{busy ? "جارٍ إرسال الدعوة..." : "إرسال دعوة"}</button>
      </form>
      {message && <p className="feedback" role="status">{message}</p>}
      <div className="table-scroll">
        <table className="admin-table">
          <thead><tr><th>الموظف</th><th>البريد</th><th>الدور</th><th>الحالة</th><th>آخر دخول</th><th>الإجراء</th></tr></thead>
          <tbody>
            {staff.map((member) => (
              <tr key={member.id}>
                <td>{member.full_name || "—"}</td><td dir="ltr">{member.email}</td>
                <td><select value={member.role} onChange={(event) => void updateMember(member, { role: event.target.value as StaffRole })}>
                  {Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select></td>
                <td><span className={member.is_active ? "state-pill active" : "state-pill inactive"}>{member.is_active ? "نشط" : "موقوف"}</span></td>
                <td>{member.last_sign_in_at ? new Date(member.last_sign_in_at).toLocaleString("ar-SA") : "لم يسجل الدخول"}</td>
                <td><button className="small-action" onClick={() => void updateMember(member, { is_active: !member.is_active })}>{member.is_active ? "إيقاف" : "تفعيل"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!staff.length && <div className="empty-state">لا يوجد موظفون بعد. أرسل أول دعوة من النموذج أعلاه.</div>}
    </section>
  );
}
