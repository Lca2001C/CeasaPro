"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Pencil,
  Receipt,
  Repeat,
  RotateCcw,
  ShoppingBag,
  Sparkles,
  Trash2,
} from "lucide-react";
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
import { IconeRedondo } from "@/components/ui/icone-redondo";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { chamarAction } from "@/lib/http/chamar-action";

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
        const res = await chamarAction(() => registrarPagamentoHigienizacao({
          id: d.id,
          amount: Number(d.amount),
          paidDate: isoDateTz(),
        }));
        if (res.ok) {
          toast.success(`${d.description} paga hoje`);
          router.refresh();
        } else {
          toast.error(res.error.message);
        }
        return;
      }
      const res = await chamarAction(() => marcarDespesaComoPaga({ id: d.id }));
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
      const res = await chamarAction(() => marcarDespesaComoPendente(d.id));
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
      const res = await chamarAction(() => excluirDespesa(d.id));
      if (res.ok) {
        toast.success("Excluído com sucesso");
        setConfirmarExclusao(false);
        router.refresh();
      } else {
        toast.error(res.error.message);
      }
    });
  }

  const daCompra = Boolean(d.purchaseId);
  const meta = [
    d.supplierName,
    daCompra ? null : EXPENSE_TYPE_LABELS[d.type],
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
          "flex flex-col gap-3 p-4 md:flex-row md:items-center md:gap-4",
          d.vencida && "border-destructive/50 bg-destructive/5",
        )}
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {/* O ícone diz de onde a conta veio; a cor, só o estado (vencida /
              paga). Some no celular estreito: ali cada pixel vai para o nome
              da conta, que precisa ser lido inteiro. */}
          <IconeRedondo
            tom={d.vencida ? "destructive" : pago ? "success" : "neutro"}
            className="hidden sm:inline-flex"
          >
            {daCompra ? <ShoppingBag /> : ehHigienizacao ? <Sparkles /> : <Receipt />}
          </IconeRedondo>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">
                {d.description}
              </span>
              <span className="shrink-0 font-bold tabular-nums">{formatBRL(d.amount)}</span>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground [overflow-wrap:anywhere]">{meta}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {d.vencida ? (
                <Badge variant="destructive">Vencida</Badge>
              ) : (
                <Badge variant={pago ? "success" : "warning"}>{pago ? "Pago" : "Pendente"}</Badge>
              )}
              {d.recurring && (
                <Badge variant="secondary" className="gap-1">
                  <Repeat aria-hidden className="size-3" /> Todo mês
                </Badge>
              )}
              {ehHigienizacao && <Badge variant="secondary">Higienização</Badge>}
              {daCompra && (
                <Link
                  href="/estoque?aba=compras"
                  title="Ver a compra no Estoque"
                  className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Badge variant="info" className="gap-1">
                    <ShoppingBag aria-hidden className="size-3" /> Compra
                  </Badge>
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* Ações escritas e coloridas em todos os tamanhos de tela: os ícones
            soltos do desktop (lápis, lixeira, cópia) exigiam adivinhar. */}
        <div className="flex flex-wrap gap-2 md:max-w-[22rem] md:shrink-0 md:justify-end">
          <Acoes
            d={d}
            pending={pending}
            onPagar={pagar}
            onDesfazer={desfazerPagamento}
            onExcluir={() => setConfirmarExclusao(true)}
            hrefHigienizacao={hrefHigienizacao}
          />
        </div>
      </Card>

      {!ehHigienizacao && !daCompra && (
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

function Acoes({
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
            <Button size="sm" variant="success" onClick={onPagar} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <Check />}
              Pagar
            </Button>
          )}
          <Button asChild size="sm" variant="info">
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
            <Button size="sm" variant="success" onClick={onPagar} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <Check />}
              Pagar
            </Button>
          )}
          {!d.purchaseId && (
            <Button asChild size="sm" variant="violet">
              <Link href={`/despesas/nova?duplicar=${d.id}`}>
                <Copy /> Duplicar
              </Link>
            </Button>
          )}
          <Button asChild size="sm" variant="info">
            <Link href={`/despesas/${d.id}`}>
              <Pencil /> Editar
            </Link>
          </Button>
          {!d.purchaseId && (
            <Button size="sm" variant="destructive" onClick={onExcluir}>
              <Trash2 /> Excluir
            </Button>
          )}
        </>
      )}
    </>
  );
}
