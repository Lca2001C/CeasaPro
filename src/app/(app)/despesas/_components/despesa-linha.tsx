"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Pencil, Repeat, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  marcarDespesaComoPaga,
  marcarDespesaComoPendente,
  excluirDespesa,
} from "@/actions/despesas.actions";
import { formatBRL, formatDate } from "@/lib/format";
import { EXPENSE_PAYMENT_METHOD_LABELS, EXPENSE_TYPE_LABELS } from "@/lib/labels";
import { cn } from "@/lib/cn";
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

export interface DespesaLinhaDados {
  id: string;
  description: string;
  amount: string;
  type: "FIXA" | "VARIAVEL";
  status: "PENDENTE" | "PAGO";
  paymentMethod: string | null;
  recurring: boolean;
  categoryName: string | null;
  dueDate: string | null;
  paidDate: string | null;
  vencida: boolean;
}

/** A partir de quantos pixels o arrasto conta como swipe, e não como toque. */
const LIMITE_SWIPE = 56;
/** Largura da gaveta de ações revelada pelo swipe. */
const LARGURA_ACOES = 112;

/**
 * Uma linha da lista de despesas.
 *
 * Concentra as três ações que o dono do box faz no celular — pagar, editar,
 * excluir — e aceita swipe para a esquerda, como todo app financeiro. O swipe é
 * um ATALHO, não o único caminho: os botões continuam no DOM, então quem usa
 * mouse, teclado ou leitor de tela não perde nada. Isso também é o que mantém a
 * linha utilizável se o gesto falhar em algum navegador.
 */
export function DespesaLinha({ d }: { d: DespesaLinhaDados }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  const [aberta, setAberta] = useState(false);
  const inicioX = useRef<number | null>(null);
  const [arrasto, setArrasto] = useState(0);

  const pago = d.status === "PAGO";

  function pagar() {
    start(async () => {
      const res = await marcarDespesaComoPaga({ id: d.id });
      if (res.ok) {
        toast.success(`${d.description} paga hoje`);
        setAberta(false);
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
        setAberta(false);
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
        setAberta(false);
        router.refresh();
      } else {
        toast.error(res.error.message);
      }
    });
  }

  // ── Gesto de swipe (só toque; mouse tem os botões) ────────────────────
  function onTouchStart(e: React.TouchEvent) {
    inicioX.current = e.touches[0]!.clientX;
  }
  function onTouchMove(e: React.TouchEvent) {
    if (inicioX.current === null) return;
    const delta = e.touches[0]!.clientX - inicioX.current;
    // Só para a esquerda, e nunca além da largura da gaveta.
    setArrasto(Math.max(-LARGURA_ACOES, Math.min(0, delta)));
  }
  function onTouchEnd() {
    if (inicioX.current === null) return;
    setAberta(arrasto <= -LIMITE_SWIPE);
    setArrasto(0);
    inicioX.current = null;
  }

  const deslocamento = arrasto !== 0 ? arrasto : aberta ? -LARGURA_ACOES : 0;

  return (
    <div className="relative overflow-hidden rounded-lg">
      {/* Gaveta revelada pelo swipe. `aria-hidden`: os mesmos comandos existem
          nos botões da linha, então anunciá-los duas vezes só atrapalharia. */}
      <div
        className="absolute inset-y-0 right-0 flex items-stretch md:hidden"
        aria-hidden={!aberta}
      >
        {!pago && (
          <button
            type="button"
            onClick={pagar}
            disabled={pending}
            className="flex w-14 flex-col items-center justify-center gap-1 bg-success text-xs font-medium text-success-foreground"
          >
            <Check className="size-4" />
            Pagar
          </button>
        )}
        <button
          type="button"
          onClick={() => setConfirmarExclusao(true)}
          disabled={pending}
          className="flex w-14 flex-col items-center justify-center gap-1 bg-destructive text-xs font-medium text-destructive-foreground"
        >
          <Trash2 className="size-4" />
          Excluir
        </button>
      </div>

      <Card
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{ transform: `translateX(${deslocamento}px)` }}
        className={cn(
          "flex items-center justify-between gap-2 p-3 transition-transform",
          d.vencida && "border-destructive/50 bg-destructive/5",
        )}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium">{d.description}</span>
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
          </div>
          <span className="text-xs text-muted-foreground">
            {EXPENSE_TYPE_LABELS[d.type]}
            {d.categoryName ? ` · ${d.categoryName}` : ""}
            {pago
              ? d.paidDate
                ? ` · pago ${formatDate(d.paidDate)}`
                : ""
              : d.dueDate
                ? ` · vence ${formatDate(d.dueDate)}`
                : " · sem vencimento"}
            {d.paymentMethod ? ` · ${EXPENSE_PAYMENT_METHOD_LABELS[d.paymentMethod]}` : ""}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <span className="font-semibold tabular-nums">{formatBRL(d.amount)}</span>

          {/* Pagar em UM toque — o caminho mais usado do módulo. */}
          {pago ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Voltar para pendente"
              title="Voltar para pendente"
              onClick={desfazerPagamento}
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
              onClick={pagar}
              disabled={pending}
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4 text-success" />
              )}
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

          <Button
            variant="ghost"
            size="icon"
            aria-label="Excluir"
            title="Excluir"
            onClick={() => setConfirmarExclusao(true)}
          >
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      </Card>

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
    </div>
  );
}
