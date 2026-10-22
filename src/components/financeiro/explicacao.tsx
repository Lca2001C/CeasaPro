"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Info } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
// Só o TIPO: o módulo das explicações usa `@/lib/money` e roda no servidor.
import type { Explicacao } from "@/lib/financeiro/explicacoes";

/**
 * "Como é calculado": a janela que abre ao tocar num número do Início.
 *
 * Recebe a explicação pronta do servidor (texto já formatado) — a conta é a
 * mesma do card, montada em `lib/financeiro/explicacoes.ts`.
 */
function JanelaDaExplicacao({ e }: { e: Explicacao }) {
  return (
    <DialogContent className="max-h-[90dvh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{e.titulo}</DialogTitle>
        <DialogDescription>{e.resumo}</DialogDescription>
      </DialogHeader>

      <p className="text-xs text-muted-foreground">{e.periodo}</p>

      {(e.parcelas.length > 0 || e.total) && (
        <section aria-label="A conta" className="rounded-lg border bg-muted/40 p-3">
          <ul className="flex flex-col gap-2 text-sm">
            {e.parcelas.map((p, i) => (
              <li key={`${p.rotulo}-${i}`} className="flex flex-col">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    <span aria-hidden className="mr-1 inline-block w-3 font-semibold">
                      {p.sinal}
                    </span>
                    <span className="sr-only">{p.sinal === "+" ? "mais" : "menos"} </span>
                    <span>{p.rotulo}</span>
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">{p.valor}</span>
                </span>
                {p.detalhe && (
                  <span className="ml-4 text-xs text-muted-foreground">{p.detalhe}</span>
                )}
              </li>
            ))}
            {e.total && (
              <li
                className={cn(
                  "flex items-baseline justify-between gap-3 font-bold",
                  e.parcelas.length > 0 && "border-t pt-2",
                )}
              >
                <span>
                  {e.parcelas.length > 0 && (
                    <span aria-hidden className="mr-1 inline-block w-3">
                      =
                    </span>
                  )}
                  <span>{e.total.rotulo}</span>
                </span>
                <span className="tabular-nums">{e.total.valor}</span>
              </li>
            )}
          </ul>
        </section>
      )}

      {e.formula && (
        <ul className="flex flex-col gap-1 rounded-lg border bg-muted/40 p-3 text-sm tabular-nums">
          {e.formula.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}

      {e.extras && e.extras.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {e.extras.map((x) => (
            <li key={x.rotulo} className="flex justify-between gap-3 text-muted-foreground">
              <span>{x.rotulo}</span>
              <span className="tabular-nums">{x.valor}</span>
            </li>
          ))}
        </ul>
      )}

      <Lista titulo="O que entra" itens={e.entra} />
      <Lista titulo="O que fica de fora" itens={e.foraDaConta} />

      <DialogFooter className="gap-2 sm:gap-2">
        {e.link && (
          <Button asChild variant="info">
            <Link href={e.link.href}>{e.link.rotulo}</Link>
          </Button>
        )}
        <DialogClose asChild>
          <Button variant="outline">Fechar</Button>
        </DialogClose>
      </DialogFooter>
    </DialogContent>
  );
}

function Lista({ titulo, itens }: { titulo: string; itens: string[] }) {
  if (itens.length === 0) return null;
  return (
    <section className="text-sm">
      <h4 className="font-semibold">{titulo}</h4>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
        {itens.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </section>
  );
}

/**
 * O card inteiro como gatilho: tocar abre a explicação. `className` é a do
 * card (o botão assume o lugar da `div`/`Link` dele).
 */
export function CardComExplicacao({
  explicacao,
  className,
  children,
}: {
  explicacao: Explicacao;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`${explicacao.titulo}: como é calculado`}
          className={cn(
            "w-full cursor-pointer text-left outline-none motion-safe:transition-shadow hover:shadow-elevada focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            className,
          )}
        >
          {children}
        </button>
      </DialogTrigger>
      <JanelaDaExplicacao e={explicacao} />
    </Dialog>
  );
}

/** Botão discreto no cabeçalho de um gráfico. */
export function BotaoComoECalculado({ explicacao }: { explicacao: Explicacao }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-10 shrink-0 gap-1 px-2 text-xs text-muted-foreground"
          aria-label={`${explicacao.titulo}: como é calculado`}
        >
          <Info className="size-3.5" /> Como é calculado
        </Button>
      </DialogTrigger>
      <JanelaDaExplicacao e={explicacao} />
    </Dialog>
  );
}
