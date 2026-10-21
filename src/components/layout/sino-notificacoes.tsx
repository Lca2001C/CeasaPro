"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, BellRing, CheckCircle2, CreditCard } from "lucide-react";
import { listarNotificacoes, type Notificacao } from "@/actions/notificacoes.actions";
import { chamarAction } from "@/lib/http/chamar-action";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";

const CHAVE_VISTAS = "ceasapro:notificacoes-vistas";
const INTERVALO_MS = 5 * 60_000;

function lerVistas(): Set<string> {
  try {
    const bruto = localStorage.getItem(CHAVE_VISTAS);
    return new Set(bruto ? (JSON.parse(bruto) as string[]) : []);
  } catch {
    return new Set();
  }
}

function gravarVistas(ids: string[]) {
  try {
    localStorage.setItem(CHAVE_VISTAS, JSON.stringify(ids));
  } catch {
    // modo privado / armazenamento bloqueado: só perde o "já vi"
  }
}

/**
 * Sino de notificações do header: reúne os avisos do sistema (fiado vencido,
 * contas, higienização, cotação) e o aviso da assinatura.
 *
 * "Novidade" = notificação cujo `id` ainda não foi visto NESTE aparelho. O id
 * carrega quantidade e texto, então "2 despesas vencidas" que vira 3 acende o
 * sino de novo. Abrir o painel marca tudo como visto. O "visto" fica no
 * navegador de propósito: é conveniência de leitura, não dado do negócio.
 */
export function SinoNotificacoes({ avisoAssinatura }: { avisoAssinatura?: string | null }) {
  const pathname = usePathname();
  const [itens, setItens] = useState<Notificacao[]>([]);
  const [vistas, setVistas] = useState<Set<string>>(() => new Set());
  const [rotaDoPainel, setRotaDoPainel] = useState<string | null>(null);
  const aberto = rotaDoPainel === pathname;
  const raiz = useRef<HTMLDivElement>(null);
  const painelId = useId();
  const [destacadas, setDestacadas] = useState<Set<string>>(() => new Set());

  const todas = useMemo<Notificacao[]>(() => {
    const assinatura: Notificacao[] = avisoAssinatura
      ? [{ id: `assinatura:${avisoAssinatura}`, titulo: avisoAssinatura, detalhe: null, href: "/assinatura" }]
      : [];
    return [...assinatura, ...itens];
  }, [avisoAssinatura, itens]);

  const novas = todas.filter((n) => !vistas.has(n.id)).length;

  const carregar = useCallback(async () => {
    const res = await chamarAction(() => listarNotificacoes());
    if (res.ok) setItens(res.data);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- leitura única do armazenamento do aparelho
    setVistas(lerVistas());
    void carregar();
    const t = setInterval(() => void carregar(), INTERVALO_MS);
    const aoVoltar = () => {
      if (document.visibilityState === "visible") void carregar();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [carregar]);

  useEffect(() => {
    if (!aberto) return;
    function fora(e: MouseEvent) {
      if (!raiz.current?.contains(e.target as Node)) setRotaDoPainel(null);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") setRotaDoPainel(null);
    }
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  function alternar() {
    if (aberto) {
      setRotaDoPainel(null);
      return;
    }
    setRotaDoPainel(pathname);
    void carregar();
    // As novidades ficam marcadas "NOVO" dentro do painel; o sino apaga.
    setDestacadas(new Set(todas.filter((n) => !vistas.has(n.id)).map((n) => n.id)));
    // Guarda só os ids atuais: os que sumiram não precisam ficar para sempre.
    const ids = todas.map((n) => n.id);
    gravarVistas(ids);
    setVistas(new Set(ids));
  }

  return (
    <div ref={raiz} className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn("relative px-2.5", novas > 0 && "border-destructive/50 text-destructive")}
        aria-label={novas > 0 ? `Notificações: ${novas} nova(s)` : "Notificações"}
        aria-expanded={aberto}
        aria-haspopup="dialog"
        aria-controls={painelId}
        onClick={alternar}
      >
        {novas > 0 ? <BellRing className="animate-pulse" /> : <Bell />}
        {novas > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-bold leading-5 text-white">
            {novas > 9 ? "9+" : novas}
          </span>
        )}
      </Button>
      {aberto && (
        <div
          id={painelId}
          role="dialog"
          aria-label="Notificações"
          className="fixed inset-x-4 top-[calc(4rem+env(safe-area-inset-top))] z-50 mt-1 rounded-md border bg-background shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:w-80"
        >
          <p className="border-b px-3 py-2 text-sm font-semibold">Notificações</p>
          {todas.length === 0 ? (
            <p className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 text-primary" /> Tudo em dia. Nenhuma notificação.
            </p>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto p-1">
              {todas.map((n) => (
                <li key={n.id}>
                  <Link
                    href={n.href}
                    onClick={() => setRotaDoPainel(null)}
                    className={cn(
                      "flex items-start gap-2 rounded-sm px-3 py-2.5 text-sm hover:bg-accent",
                      destacadas.has(n.id) && "bg-primary/5",
                    )}
                  >
                    {n.id.startsWith("assinatura:") ? (
                      <CreditCard className="mt-0.5 size-4 shrink-0 text-warning" />
                    ) : (
                      <Bell className="mt-0.5 size-4 shrink-0 text-primary" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block">{n.titulo}</span>
                      {n.detalhe && (
                        <span className="block text-xs text-muted-foreground">{n.detalhe}</span>
                      )}
                    </span>
                    {destacadas.has(n.id) && (
                      <span className="mt-1 rounded-full bg-destructive px-1.5 text-[10px] font-bold text-white">
                        NOVO
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
