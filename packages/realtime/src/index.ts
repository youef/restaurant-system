"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@restaurant/db";

export function useRealtimeRefresh(table: string, filter?: string) {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`refresh-${table}-${filter ?? "all"}`)
      .on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, () => {
        setRevision((current) => current + 1);
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [table, filter]);

  return revision;
}
