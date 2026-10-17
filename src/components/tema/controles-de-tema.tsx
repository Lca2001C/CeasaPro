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

/** O que está pintado agora — "automático" resolvido pelo aparelho. No servidor, claro. */
function useEscuroNaTela(): boolean {
  return useSyncExternalStore(
    assinarTema,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
}

/**
 * Botão do header: um toque alterna entre claro e escuro a partir do que está
 * NA TELA (em "automático" com o aparelho escuro, o toque vai para claro). O
 * "Automático" continua no seletor completo de Configurações.
 *
 * Os dois ícones vão no HTML e o CSS (`dark:`) escolhe qual aparece: o servidor
 * não sabe o tema, e decidir o ícone no JS faria ele trocar depois da carga.
 */
export function BotaoModoEscuro({ className }: { className?: string }) {
  const escuro = useEscuroNaTela();
  return (
    <button
      type="button"
      onClick={() => salvarTema(escuro ? "claro" : "escuro")}
      aria-label="Modo escuro"
      aria-pressed={escuro}
      title={escuro ? "Usar modo claro" : "Usar modo escuro"}
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring motion-safe:transition-colors",
        className,
      )}
    >
      <Moon aria-hidden className="size-5 dark:hidden" />
      <Sun aria-hidden className="hidden size-5 dark:block" />
    </button>
  );
}
