"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@restaurant/db/client";

export function useRealtimeRefresh(table: string, filter?: string) {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let active = true;
    const refresh = () => {
      if (active && !document.hidden) setRevision((current) => current + 1);
    };
    const channel = supabase
      .channel(`refresh-${table}-${filter ?? "all"}`)
      .on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, refresh)
      .subscribe((status) => {
        // If Realtime disconnects, trigger a refresh and rely on the polling fallback.
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") refresh();
      });

    // Keep staff/customer screens fresh even when Realtime drops or mobile browsers suspend sockets.
    const timer = window.setInterval(refresh, 20_000);
    const onFocus = () => refresh();
    const onVisibility = () => { if (!document.hidden) refresh(); };
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      void supabase.removeChannel(channel);
    };
  }, [table, filter]);

  return revision;
}
