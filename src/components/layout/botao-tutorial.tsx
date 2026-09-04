"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Compass, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { iniciarTour } from "@/lib/tour/estado";

/**
 * Atalho permanente no topo: o guia escrito e o tour guiado.
 *
 * Saiu da barra lateral de propósito. "Como usar" no meio do menu operacional
 * compete com Vender e Estoque, e quem precisa de ajuda não vai caçar um item
 * no "Mais". No header o atalho fica visível em qualquer tela — o mesmo lugar
 * em que a pessoa já olha para sair.
 *
 * Um botão só, com as duas saídas: a página de uso (leitura) e o tour (mostrar
 * as telas). Começar o tour daqui é o mesmo `iniciarTour` do convite do Início
 * e do botão dentro de `/ajuda`.
 */
export function BotaoTutorial() {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const pathname = usePathname();

  useEffect(() => {
    setAberto(false);
  }, [pathname]);

  useEffect(() => {
    if (!aberto) return;
    function fora(e: MouseEvent) {
      if (!raiz.current?.contains(e.target as Node)) setAberto(false);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  return (
    <div ref={raiz} className="relative" data-tour="tutorial">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5 px-2.5 sm:px-3"
        aria-label="Tutorial"
        aria-expanded={aberto}
        aria-haspopup="menu"
        aria-controls={menuId}
        onClick={() => setAberto((v) => !v)}
      >
        <span className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground [&_svg]:size-2.5">
          <Play className="fill-current" />
        </span>
        Tutorial
      </Button>
      {aberto && (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-52 rounded-md border bg-background p-1 shadow-md"
        >
          <Link
            role="menuitem"
            href="/ajuda"
            className="flex items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-accent"
            onClick={() => setAberto(false)}
          >
            <BookOpen className="size-4 shrink-0 text-primary" />
            Página de uso
          </Link>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
            onClick={() => {
              setAberto(false);
              iniciarTour();
            }}
          >
            <Compass className="size-4 shrink-0 text-primary" />
            Tour guiado
          </button>
        </div>
      )}
    </div>
  );
}
