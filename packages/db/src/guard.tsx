import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import type { AppRole } from "./types";

interface StaffGuardProps {
  allowedRoles: readonly Exclude<AppRole, "guest">[];
  children: ReactNode;
}

export async function StaffGuard({ allowedRoles, children }: StaffGuardProps) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return <section role="alert">إعدادات الاتصال بقاعدة البيانات غير مكتملة.</section>;
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (values) => {
        try {
          values.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Cookie writes may be unavailable while rendering a Server Component.
        }
      }
    }
  });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role,is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !profile?.is_active || !allowedRoles.includes(profile.role as Exclude<AppRole, "guest">)) {
    await supabase.auth.signOut();
    redirect("/login?reason=role");
  }

  return children;
}
