"use client";

import { useSyncExternalStore } from "react";

/**
 * Está online? Assina `online`/`offline` do navegador.
 *
 * `useSyncExternalStore` em vez de `useState` + efeito: é leitura de estado
 * externo, e o `getServerSnapshot` devolvendo `true` garante que o HTML do
 * servidor nunca sai com faixa de "sem conexão" — o servidor, por definição,
 * respondeu.
 *
 * Aviso honesto sobre o que `navigator.onLine` significa: ele diz que existe
 * interface de rede, NÃO que a internet funciona. Wi-Fi de portal cativo ou
 * sinal fraco no box aparecem como "online". Por isso ele serve para o aviso
 * visual e para bloquear escrita preventivamente, mas quem decide de verdade é a
 * requisição falhando.
 */
function assinar(notificar: () => void): () => void {
  window.addEventListener("online", notificar);
  window.addEventListener("offline", notificar);
  return () => {
    window.removeEventListener("online", notificar);
    window.removeEventListener("offline", notificar);
  };
}

const ler = () => (typeof navigator === "undefined" ? true : navigator.onLine);

export function useOnline(): boolean {
  return useSyncExternalStore(assinar, ler, () => true);
}
