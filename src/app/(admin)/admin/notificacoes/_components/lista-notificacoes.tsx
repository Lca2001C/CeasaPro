"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  marcarNotificacaoLida,
  marcarTodasNotificacoesLidas,
} from "@/actions/admin.actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * Caixa de entrada do super-admin.
 *
 * `router.refresh()` depois de cada ação em vez de estado local: a contagem da
 * campainha é renderizada no servidor, no layout. Mexer só no estado do cliente
 * marcaria o item como lido na lista e deixaria o número do cabeçalho errado até
 * a próxima navegação.
 */

export interface NotificacaoItem {
  id: string;
  title: string;
  body: string;
  href: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export function ListaNotificacoes({
  itens,
  temNaoLidas,
}: {
  itens: NotificacaoItem[];
  temNaoLidas: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function marcarUma(id: string, depois?: string | null) {
    start(async () => {
      const res = await marcarNotificacaoLida(id);
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      // Navega DEPOIS de marcar: fazer as duas coisas em paralelo perderia a
      // marcação quando a navegação descarta a requisição em voo.
      if (depois) router.push(depois);
      else router.refresh();
    });
  }

  function marcarTodas() {
    start(async () => {
      const res = await marcarTodasNotificacoesLidas();
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success(
        res.data.marcadas === 0
          ? "Nada para marcar."
          : `${res.data.marcadas} aviso(s) marcado(s) como lido.`,
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {temNaoLidas && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={marcarTodas}
            disabled={pending}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCheck className="size-4" />
            )}
            Marcar todas como lidas
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {itens.map((n) => {
          const naoLida = n.readAt === null;
          return (
            <Card
              key={n.id}
              className={cn(
                "flex flex-col gap-2 p-3",
                naoLida && "border-primary/40 bg-accent/40",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("text-sm", naoLida && "font-semibold")}>
                  {n.title}
                </span>
                {naoLida && <Badge variant="default">Novo</Badge>}
                <span className="ml-auto text-xs text-muted-foreground">
                  {formatDateTime(n.createdAt)}
                </span>
              </div>

              <p className="text-sm text-muted-foreground">{n.body}</p>

              <div className="flex flex-wrap gap-2">
                {n.href && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => marcarUma(n.id, n.href)}
                    disabled={pending}
                  >
                    Ver empresa
                  </Button>
                )}
                {naoLida && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => marcarUma(n.id)}
                    disabled={pending}
                  >
                    <Check className="size-4" />
                    Marcar como lida
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
