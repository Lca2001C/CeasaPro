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
 *
 * Aberto/fechado é derivado da rota: guardar um boolean e zerá-lo num efeito
 * quando a URL muda viola `react-hooks/set-state-in-effect` (o lint do CI).
 * Guardar em *qual rota* o menu foi aberto faz a navegação fechá-lo sozinha.
 */
export function BotaoTutorial() {
  const pathname = usePathname();
  const [rotaDoMenu, setRotaDoMenu] = useState<string | null>(null);
  const aberto = rotaDoMenu === pathname;
  const raiz = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!aberto) return;
    function fora(e: MouseEvent) {
      if (!raiz.current?.contains(e.target as Node)) setRotaDoMenu(null);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") setRotaDoMenu(null);
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
        onClick={() => setRotaDoMenu((atual) => (atual === pathname ? null : pathname))}
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
            onClick={() => setRotaDoMenu(null)}
          >
            <BookOpen className="size-4 shrink-0 text-primary" />
            Página de uso
          </Link>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
            onClick={() => {
              setRotaDoMenu(null);
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
