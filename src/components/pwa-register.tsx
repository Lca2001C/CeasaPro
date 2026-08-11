"use client";

import { useEffect } from "react";

/**
 * Em produção: registra o service worker (PWA).
 * Em dev: DESREGISTRA qualquer SW remanescente de um build de produção anterior e
 * limpa os caches. Sem isso, um SW antigo continua controlando a página no dev e
 * serve chunks de JS em cache (incompatíveis com o dev) → o app/login "quebra"
 * mesmo com o servidor correto no ar.
 */
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((r) => r.unregister()))
        .catch(() => {});
      if (typeof caches !== "undefined") {
        caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {});
      }
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // sem SW o app continua funcionando normalmente
    });
  }, []);
  return null;
}
