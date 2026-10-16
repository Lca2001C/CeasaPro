"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  aplicarTema,
  assinarTema,
  lerTema,
  ROTULO_DO_TEMA,
  salvarTema,
  TEMAS,
  type Tema,
} from "@/lib/tema";
import { cn } from "@/lib/cn";

const ICONE: Record<Tema, typeof Sun> = { claro: Sun, escuro: Moon, auto: Monitor };

/** Tema escolhido neste aparelho. No servidor, "auto" (o script do `<head>` já pintou certo). */
export function useTema(): Tema {
  return useSyncExternalStore(assinarTema, lerTema, () => "auto");
}

/**
 * Mantém o tema vivo depois da carga: o sistema mudando de claro para escuro
 * com o app aberto em "automático", e a cor da barra do navegador (as metas
 * `theme-color` só existem depois do script do `<head>`). Não renderiza nada.
 */
export function SincronizadorDeTema() {
  const tema = useTema();
  useEffect(() => {
    aplicarTema(tema);
  }, [tema]);
  return null;
}

/**
 * Seletor completo — Claro / Escuro / Automático — para Configurações.
 * É um grupo de rádio: setas mudam a opção, e o leitor de tela anuncia
 * "Tema, Escuro, selecionado, 2 de 3".
 */
export function SeletorDeTema({ className }: { className?: string }) {
  const tema = useTema();
  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className={cn("grid grid-cols-3 gap-1 rounded-full bg-muted p-1", className)}
    >
      {TEMAS.map((t) => {
        const Icone = ICONE[t];
        const ativo = t === tema;
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={ativo}
            tabIndex={ativo ? 0 : -1}
            onClick={() => salvarTema(t)}
            onKeyDown={(e) => {
              const i = TEMAS.indexOf(t);
              const passo =
                e.key === "ArrowRight" || e.key === "ArrowDown"
                  ? 1
                  : e.key === "ArrowLeft" || e.key === "ArrowUp"
                    ? -1
                    : 0;
              if (!passo) return;
              e.preventDefault();
              const proximo = TEMAS[(i + passo + TEMAS.length) % TEMAS.length]!;
              salvarTema(proximo);
              (e.currentTarget.parentElement?.children[TEMAS.indexOf(proximo)] as
                | HTMLElement
                | undefined)?.focus();
            }}
            className={cn(
              "flex min-h-11 items-center justify-center gap-1.5 rounded-full px-2 text-sm font-semibold outline-none motion-safe:transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              ativo
                ? "bg-superficie text-foreground shadow-suave"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icone aria-hidden className="size-4 shrink-0" />
            {ROTULO_DO_TEMA[t]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Atalho do menu: um toque passa para o próximo tema (Claro → Escuro →
 * Automático). O nome diz o tema ATUAL e o que o toque faz.
 */
export function AtalhoDeTema({ className }: { className?: string }) {
  const tema = useTema();
  const proximo = TEMAS[(TEMAS.indexOf(tema) + 1) % TEMAS.length]!;
  const Icone = ICONE[tema];
  return (
    <button
      type="button"
      onClick={() => salvarTema(proximo)}
      aria-label={`Tema: ${ROTULO_DO_TEMA[tema]}. Tocar para mudar para ${ROTULO_DO_TEMA[proximo]}`}
      className={cn(
        "flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground outline-none hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <Icone aria-hidden className="size-5 shrink-0" />
      <span>
        Tema: <span className="font-semibold text-foreground">{ROTULO_DO_TEMA[tema]}</span>
      </span>
    </button>
  );
}
