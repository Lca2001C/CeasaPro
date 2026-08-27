"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Busca de produto no estoque.
 *
 * Filtra na URL (`?q=`) para o estado sobreviver a recarregar a página e voltar
 * do navegador — e para o link ser compartilhável entre quem confere o estoque.
 */
export function BuscaEstoque() {
  const router = useRouter();
  const params = useSearchParams();
  const inicial = params.get("q") ?? "";
  const [termo, setTermo] = useState(inicial);
  const [urlAnterior, setUrlAnterior] = useState(inicial);

  // Ajuste durante o render (padrão do React) em vez de efeito com setState:
  // a URL muda por fora quando se troca o filtro Com saldo / Zerados / Todos.
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
      router.replace(`/estoque?${novo.toString()}`);
    }, 350);
    return () => clearTimeout(t);
  }, [termo, inicial, params, router]);

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
        placeholder="Buscar produto…"
        aria-label="Buscar produto no estoque"
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
