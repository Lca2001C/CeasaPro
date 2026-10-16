"use client";

import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatBRL } from "@/lib/format";
import {
  agruparPorPrimeiraPalavra,
  casaPelaPrimeiraPalavra,
  primeiraPalavra,
} from "@/lib/cotacoes/nome";

export interface ProdutoSugerido {
  id: string;
  name: string;
  saleUnit?: string;
  salePrice?: number | null;
}

/**
 * "Seus produtos — clique para preencher", no topo do cadastro.
 *
 * Com o nome vazio, mostra as famílias (TOMATE, UVA…); tocar numa abre os
 * produtos dela. Enquanto o nome é digitado, filtra pela PRIMEIRA palavra —
 * "uva" mostra só as uvas, e "italiano" não traz o tomate italiano.
 */
export function SeusProdutos({
  produtos,
  nomeDigitado,
  onEscolher,
}: {
  produtos: ProdutoSugerido[];
  nomeDigitado: string;
  onEscolher: (p: ProdutoSugerido) => void;
}) {
  const [grupoAberto, setGrupoAberto] = useState<string | null>(null);
  const grupos = useMemo(() => agruparPorPrimeiraPalavra(produtos, (p) => p.name), [produtos]);
  const digitando = primeiraPalavra(nomeDigitado) !== "";

  const visiveis = digitando
    ? produtos.filter((p) => casaPelaPrimeiraPalavra(p.name, nomeDigitado))
    : (grupos.find((g) => g.chave === grupoAberto)?.itens ?? []);

  if (grupos.length === 0 || (digitando && visiveis.length === 0)) return null;

  return (
    <section
      aria-label="Seus produtos"
      className="flex flex-col gap-2 rounded-lg border border-success/40 bg-success/5 p-3"
    >
      <p className="flex items-center gap-1.5 text-xs font-medium text-success">
        <Sparkles className="size-3.5" />
        Seus produtos — clique para preencher
      </p>

      {!digitando && (
        <div className="flex flex-wrap gap-1.5">
          {grupos.map((g) => (
            <button
              key={g.chave}
              type="button"
              aria-pressed={grupoAberto === g.chave}
              onClick={() => setGrupoAberto((v) => (v === g.chave ? null : g.chave))}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-semibold",
                grupoAberto === g.chave
                  ? "border-success bg-success text-success-foreground"
                  : "bg-background hover:bg-muted",
              )}
            >
              {g.rotulo} <span className="font-normal opacity-80">({g.itens.length})</span>
            </button>
          ))}
        </div>
      )}

      {visiveis.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {visiveis.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onEscolher(p)}
              className="rounded-md border bg-background px-2 py-1 text-left text-xs hover:bg-muted"
            >
              {p.name}
              {p.salePrice != null && (
                <span className="ml-1 text-muted-foreground">· {formatBRL(p.salePrice)}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
