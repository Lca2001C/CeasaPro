"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, Loader2, Pencil, Repeat, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  marcarDespesaComoPaga,
  marcarDespesaComoPendente,
  excluirDespesa,
} from "@/actions/despesas.actions";
import { registrarPagamentoHigienizacao } from "@/actions/higienizacao.actions";
import { formatBRL, formatDate } from "@/lib/format";
import { EXPENSE_PAYMENT_METHOD_LABELS, EXPENSE_TYPE_LABELS } from "@/lib/labels";
import { isoDateTz } from "@/lib/tz";
import { cn } from "@/lib/cn";
import type { ContaUnificada } from "@/lib/despesas/contas-unificadas";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type DespesaLinhaDados = ContaUnificada;

/**
 * Uma linha da lista de contas.
 *
 * No celular a linha EMPILHA (título, metadados, valor, botões com rótulo).
 * O swipe antigo deslocava o card inteiro e cortava a descrição; o público do
 * box precisa ver o nome da conta e um botão Pagar óbvio, sem gesto escondido.
 * No desktop os ícones compactos continuam — há espaço.
 */
export function DespesaLinha({ d }: { d: DespesaLinhaDados }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);

  const pago = d.status === "PAGO";
  const ehHigienizacao = d.origem === "higienizacao";
  const hrefHigienizacao = `/higienizacao/${d.id}`;

  function pagar() {
    start(async () => {
      if (ehHigienizacao) {
        const res = await registrarPagamentoHigienizacao({
          id: d.id,
          amount: Number(d.amount),
          paidDate: isoDateTz(),
        });
        if (res.ok) {
          toast.success(`${d.description} paga hoje`);
          router.refresh();
        } else {
          toast.error(res.error.message);
        }
        return;
      }
      const res = await marcarDespesaComoPaga({ id: d.id });
      if (res.ok) {
        toast.success(`${d.description} paga hoje`);
        router.refresh();
      } else {
        toast.error(res.error.message);
      }
    });
  }

  function desfazerPagamento() {
    start(async () => {
      const res = await marcarDespesaComoPendente(d.id);
      if (res.ok) {
        toast.success("Despesa voltou para pendente");
        router.refresh();
      } else {
        toast.error(res.error.message);
      }
    });
  }

  function excluir() {
    start(async () => {
      const res = await excluirDespesa(d.id);
      if (res.ok) {
        toast.success("Excluído com sucesso");
        setConfirmarExclusao(false);
        router.refresh();
      } else {
        toast.error(res.error.message);
      }
    });
  }

  const meta = [
    EXPENSE_TYPE_LABELS[d.type],
    d.categoryName,
    pago
      ? d.paidDate
        ? `pago ${formatDate(d.paidDate)}`
        : null
      : d.dueDate
        ? `vence ${formatDate(d.dueDate)}`
        : "sem vencimento",
    d.paymentMethod ? EXPENSE_PAYMENT_METHOD_LABELS[d.paymentMethod] : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div>
      <Card
        className={cn(
          "flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between md:gap-3",
          d.vencida && "border-destructive/50 bg-destructive/5",
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium [overflow-wrap:anywhere]">{d.description}</span>
            {d.vencida ? (
              <Badge variant="destructive">Vencida</Badge>
            ) : (
              <Badge variant={pago ? "success" : "warning"}>{pago ? "Pago" : "Pendente"}</Badge>
            )}
            {d.recurring && (
              <Badge variant="secondary" className="gap-1">
                <Repeat className="size-3" /> Todo mês
              </Badge>
            )}
            {ehHigienizacao && <Badge variant="secondary">Higienização</Badge>}
          </div>
          <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">{meta}</p>
        </div>

        <span className="shrink-0 font-semibold tabular-nums">{formatBRL(d.amount)}</span>

        <div className="hidden shrink-0 items-center gap-1 md:flex">
          <AcoesIcone
            d={d}
            pending={pending}
            onPagar={pagar}
            onDesfazer={desfazerPagamento}
            onExcluir={() => setConfirmarExclusao(true)}
            hrefHigienizacao={hrefHigienizacao}
          />
        </div>

        <div className="flex flex-wrap gap-2 md:hidden">
          <AcoesMobile
            d={d}
            pending={pending}
            onPagar={pagar}
            onDesfazer={desfazerPagamento}
            onExcluir={() => setConfirmarExclusao(true)}
            hrefHigienizacao={hrefHigienizacao}
          />
        </div>
      </Card>

      {!ehHigienizacao && (
        <Dialog open={confirmarExclusao} onOpenChange={setConfirmarExclusao}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Excluir a despesa {d.description}?</DialogTitle>
              <DialogDescription>Esta ação não poderá ser desfeita.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancelar</Button>
              </DialogClose>
              <Button variant="destructive" onClick={excluir} disabled={pending}>
                {pending && <Loader2 className="animate-spin" />}
                Excluir
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function AcoesIcone({
  d,
  pending,
  onPagar,
  onDesfazer,
  onExcluir,
  hrefHigienizacao,
}: {
  d: DespesaLinhaDados;
  pending: boolean;
  onPagar: () => void;
  onDesfazer: () => void;
  onExcluir: () => void;
  hrefHigienizacao: string;
}) {
  const pago = d.status === "PAGO";
  const ehHigienizacao = d.origem === "higienizacao";

  return (
    <>
      {ehHigienizacao ? (
        <>
          {!pago && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Marcar ${d.description} como paga`}
              title="Marcar como paga"
              onClick={onPagar}
              disabled={pending}
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4 text-success" />}
            </Button>
          )}
          <Button asChild variant="ghost" size="icon" aria-label="Ver higienização" title="Ver higienização">
            <Link href={hrefHigienizacao}>
              <ExternalLink className="size-4 text-muted-foreground" />
            </Link>
          </Button>
        </>
      ) : (
        <>
          {pago ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Voltar para pendente"
              title="Voltar para pendente"
              onClick={onDesfazer}
              disabled={pending}
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RotateCcw className="size-4 text-muted-foreground" />
              )}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Marcar ${d.description} como paga`}
              title="Marcar como paga"
              onClick={onPagar}
              disabled={pending}
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4 text-success" />}
            </Button>
          )}
          <Button asChild variant="ghost" size="icon" aria-label="Duplicar" title="Duplicar">
            <Link href={`/despesas/nova?duplicar=${d.id}`}>
              <Copy className="size-4 text-muted-foreground" />
            </Link>
          </Button>
          <Button asChild variant="ghost" size="icon" aria-label="Editar" title="Editar">
            <Link href={`/despesas/${d.id}`}>
              <Pencil className="size-4" />
            </Link>
          </Button>
          <Button variant="ghost" size="icon" aria-label="Excluir" title="Excluir" onClick={onExcluir}>
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </>
      )}
    </>
  );
}

function AcoesMobile({
  d,
  pending,
  onPagar,
  onDesfazer,
  onExcluir,
  hrefHigienizacao,
}: {
  d: DespesaLinhaDados;
  pending: boolean;
  onPagar: () => void;
  onDesfazer: () => void;
  onExcluir: () => void;
  hrefHigienizacao: string;
}) {
  const pago = d.status === "PAGO";
  const ehHigienizacao = d.origem === "higienizacao";

  return (
    <>
      {ehHigienizacao ? (
        <>
          {!pago && (
            <Button
              size="sm"
              className="bg-success text-success-foreground hover:bg-success/90"
              onClick={onPagar}
              disabled={pending}
            >
              {pending ? <Loader2 className="animate-spin" /> : <Check />}
              Pagar
            </Button>
          )}
          <Button asChild size="sm" variant="outline">
            <Link href={hrefHigienizacao}>
              <ExternalLink /> Ver
            </Link>
          </Button>
        </>
      ) : (
        <>
          {pago ? (
            <Button size="sm" variant="outline" onClick={onDesfazer} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
              Desfazer
            </Button>
          ) : (
            <Button
              size="sm"
              className="bg-success text-success-foreground hover:bg-success/90"
              onClick={onPagar}
              disabled={pending}
            >
              {pending ? <Loader2 className="animate-spin" /> : <Check />}
              Pagar
            </Button>
          )}
          <Button asChild size="sm" variant="outline">
            <Link href={`/despesas/nova?duplicar=${d.id}`}>
              <Copy /> Duplicar
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={`/despesas/${d.id}`}>
              <Pencil /> Editar
            </Link>
          </Button>
          <Button size="sm" variant="destructive" onClick={onExcluir}>
            <Trash2 /> Excluir
          </Button>
        </>
      )}
    </>
  );
}
