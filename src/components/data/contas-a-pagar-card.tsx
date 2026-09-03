import Link from "next/link";
import { AlertTriangle, CalendarClock, ChevronRight, ReceiptText } from "lucide-react";
import { formatBRL, formatDate, valorExibivel } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { ContasAPagar } from "@/lib/services/contas-pagar.service";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface ContaProxima {
  id: string;
  description: string;
  amount: string;
  dueDate: string | null;
  categoryName: string | null;
  vencida: boolean;
}

/**
 * "Tudo a pagar" na home.
 *
 * O dono do box não pensa em módulos — ele pergunta "quanto tenho que pagar
 * esta semana?". A resposta estava espalhada entre despesas e higienização, sem
 * ninguém somando. Aqui as origens aparecem juntas, com o total dos próximos 7
 * dias em destaque e as três contas mais próximas clicáveis, para o caminho ser
 * aviso → conta → pagar, sem escala.
 */
export function ContasAPagarCard({
  contas,
  proximas,
  totalProximas,
  countProximas,
}: {
  contas: ContasAPagar;
  proximas: ContaProxima[];
  totalProximas: string;
  countProximas: number;
}) {
  if (contas.origens.length === 0 && proximas.length === 0) {
    return (
      <Card>
        <CardContent className="pt-4 text-sm text-muted-foreground">
          Nenhuma conta em aberto. Tudo pago por aqui.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <CalendarClock className="size-4 shrink-0" />
            <span className="min-w-0 truncate">Próximos 7 dias</span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block font-bold tabular-nums text-warning">
              {valorExibivel(formatBRL(totalProximas))}
            </span>
            <span className="block text-xs text-muted-foreground">
              {countProximas} conta{countProximas === 1 ? "" : "s"}
            </span>
          </span>
        </div>

        {/* As três contas mais próximas, cada uma abrindo direto na despesa. */}
        {proximas.length > 0 && (
          <div className="flex flex-col divide-y">
            {proximas.map((c) => (
              <Link
                key={c.id}
                href={`/despesas/${c.id}`}
                className="flex items-center justify-between gap-3 py-2 text-sm transition-colors hover:bg-muted/50"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {c.vencida && <AlertTriangle className="size-4 shrink-0 text-destructive" />}
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{c.description}</span>
                    <span className="block text-xs text-muted-foreground">
                      {c.vencida ? "Venceu " : "Vence "}
                      {formatDate(c.dueDate)}
                      {c.categoryName ? ` · ${c.categoryName}` : ""}
                    </span>
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 font-semibold tabular-nums",
                    c.vencida && "text-destructive",
                  )}
                >
                  {valorExibivel(formatBRL(c.amount))}
                </span>
              </Link>
            ))}
          </div>
        )}

        {/* Total por origem: é o que responde "quanto devo, tudo somado". */}
        {contas.origens.length > 0 && (
          <div className="flex flex-col gap-1 border-t pt-2">
            {contas.origens.map((o) => (
              <Link
                key={o.chave}
                href={o.href}
                className="flex items-center justify-between gap-3 rounded-md px-1 py-1.5 text-sm transition-colors hover:bg-muted/50"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <ReceiptText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">{o.label}</span>
                  {o.urgente && <Badge variant="destructive">{o.count}</Badge>}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="font-semibold tabular-nums">
                    {valorExibivel(formatBRL(o.total))}
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </span>
              </Link>
            ))}
            <div className="mt-1 flex items-center justify-between gap-3 border-t px-1 pt-2 text-sm">
              <span className="font-semibold">Tudo a pagar</span>
              <span className="font-bold tabular-nums">
                {valorExibivel(formatBRL(contas.total))}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
