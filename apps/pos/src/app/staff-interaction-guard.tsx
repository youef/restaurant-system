"use client";

import { useEffect } from "react";

export function StaffInteractionGuard() {
  useEffect(() => {
    const stop = (event: Event) => event.preventDefault();
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (["+", "=", "-", "_", "0", "v"].includes(key) || event.code === "NumpadAdd" || event.code === "NumpadSubtract") {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const onWheel = (event: WheelEvent) => { if (event.ctrlKey || event.metaKey) event.preventDefault(); };
    const onTouchMove = (event: TouchEvent) => { if (event.touches.length > 1) event.preventDefault(); };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("paste", stop, true);
    document.addEventListener("gesturestart", stop, { capture: true, passive: false });
    document.addEventListener("gesturechange", stop, { capture: true, passive: false });
    document.addEventListener("wheel", onWheel, { capture: true, passive: false });
    document.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("paste", stop, true);
      document.removeEventListener("gesturestart", stop, true);
      document.removeEventListener("gesturechange", stop, true);
      document.removeEventListener("wheel", onWheel, true);
      document.removeEventListener("touchmove", onTouchMove, true);
    };
  }, []);
  return null;
}
