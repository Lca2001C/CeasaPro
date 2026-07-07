"use client";

import { useEffect } from "react";

/** Registra o service worker (apenas em produção). */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // sem SW o app continua funcionando normalmente
      });
    }
  }, []);
  return null;
}
