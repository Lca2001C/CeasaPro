"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Busca por nome do cliente, no topo da lista.
 *
 * Quem tem trinta contas em aberto não acha "Seu Zé" rolando a tela com a mão
 * ocupada. A busca é feita no SERVIDOR (query `?q=`), então funciona sobre
 * todas as contas, não só as que já foram carregadas.
 *
 * O `debounce` evita disparar uma navegação por tecla digitada.
 */
export function BuscaFiado() {
  const router = useRouter();
  const params = useSearchParams();
  const inicial = params.get("q") ?? "";
  const [termo, setTermo] = useState(inicial);
  const [urlAnterior, setUrlAnterior] = useState(inicial);

  // A URL pode mudar por fora (voltar do navegador, trocar o filtro de status).
  // Ajustar durante o render é o padrão do React para isso — um `useEffect`
  // com setState provocaria um render em cascata a cada navegação.
  if (inicial !== urlAnterior) {
    setUrlAnterior(inicial);
    setTermo(inicial);
  }

  useEffect(() => {
    if (termo === inicial) return;
    const t = setTimeout(() => {
      const novo = new URLSearchParams(params.toString());
      if (termo.trim()) novo.set("q", termo.trim());
      else novo.delete("q");
      router.replace(`/fiado?${novo.toString()}`);
    }, 350);
    return () => clearTimeout(t);
  }, [termo, inicial, params, router]);

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
        placeholder="Buscar cliente pelo nome"
        aria-label="Buscar cliente pelo nome"
        className="h-12 pl-9 pr-10"
      />
      {termo && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Limpar busca"
          className="absolute right-1 top-1/2 -translate-y-1/2"
          onClick={() => setTermo("")}
        >
          <X className="size-4" />
        </Button>
      )}
    </div>
  );
}
