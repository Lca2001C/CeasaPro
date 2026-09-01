"use client";

import { useEffect } from "react";
import { salvarSnapshot } from "@/lib/pwa/offline-store";

/**
 * Busca o snapshot de consulta offline e guarda no IndexedDB.
 *
 * Montado no dashboard — a tela que todo mundo abre — em vez de num intervalo
 * global: sem Background Sync no iOS, sincronizar só acontece com o app aberto,
 * então o melhor momento é quando o usuário já está olhando a tela que traz esses
 * mesmos números.
 *
 * O debounce de 5 minutos existe porque o dashboard é revisitado muitas vezes ao
 * dia. Sem ele, cada volta ao Início dispararia uma consulta que agrega vendas,
 * estoque e fiado da empresa inteira — custo desproporcional para um dado que
 * envelhece bem por alguns minutos.
 *
 * Não renderiza nada e nunca interrompe o usuário: falha de rede aqui é silenciosa,
 * porque o snapshot é conveniência, não parte do fluxo.
 */

const CHAVE_ULTIMO_SYNC = "pwa-last-snapshot-at";
const INTERVALO_MINIMO_MS = 5 * 60 * 1000;

function passouDoIntervalo(): boolean {
  try {
    const bruto = localStorage.getItem(CHAVE_ULTIMO_SYNC);
    if (!bruto) return true;
    const quando = Number(bruto);
    if (!Number.isFinite(quando)) return true;
    return Date.now() - quando >= INTERVALO_MINIMO_MS;
  } catch {
    // Sem storage não há como aplicar o debounce; sincroniza (é só uma leitura).
    return true;
  }
}

function marcarSync() {
  try {
    localStorage.setItem(CHAVE_ULTIMO_SYNC, String(Date.now()));
  } catch {
    /* sem storage: na próxima montagem sincroniza de novo */
  }
}

export function OfflineSync() {
  useEffect(() => {
    // Offline não há o que buscar; a tela de consulta usa o que já está salvo.
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    if (!passouDoIntervalo()) return;

    // `AbortController` para não gravar snapshot de uma navegação abandonada.
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch("/api/pwa/snapshot", {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!res.ok) return;
        const corpo = (await res.json()) as { ok?: boolean; data?: unknown };
        if (!corpo?.ok || !corpo.data) return;
        const guardou = await salvarSnapshot(corpo.data as never);
        // Só marca o debounce se realmente guardou: se o armazenamento recusou,
        // a próxima visita deve tentar de novo em vez de esperar 5 minutos.
        if (guardou) marcarSync();
      } catch {
        // Rede caiu, aba fechou, cota estourou: nada a fazer e nada a avisar.
      }
    })();

    return () => controller.abort();
  }, []);

  return null;
}
