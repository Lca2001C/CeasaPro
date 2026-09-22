"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, ArrowLeftRight, CalendarClock, Undo2 } from "lucide-react";
import { toast } from "sonner";
import type { AvailablePlan, PlanoView } from "@/lib/services/plano.service";
import { trocarPlano, cancelarTrocaDePlano } from "@/actions/plano.actions";
import { apiPost } from "@/lib/api-client";
import { formatBRL, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export function TrocarPlano({
  plans,
  pendingPlan,
}: {
  plans: AvailablePlan[];
  /** Troca já contratada que só passa a valer na próxima competência. */
  pendingPlan: PlanoView["pendingPlan"];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<AvailablePlan | null>(null);
  const [pending, start] = useTransition();

  const outros = plans.filter((p) => !p.isCurrent);
  if (outros.length === 0) return null;

  function confirmar() {
    if (!selected) return;
    const alvo = selected;
    start(async () => {
      const res = await trocarPlano({ planId: alvo.id });
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      // Renova a sessão para os módulos do novo plano valerem na hora (claim do JWT).
      await apiPost("/api/auth/refresh", {});
      setSelected(null);
      // A mensagem tem de dizer a verdade: com o mês já pago o servidor AGENDA a
      // troca em vez de aplicá-la, e anunciar "plano alterado" faria a pessoa
      // procurar os módulos novos que ainda não valem.
      if (res.data.scheduled) {
        toast.success(
          `Troca para ${alvo.name} agendada para ${
            res.data.effectiveFrom ? formatDate(res.data.effectiveFrom) : "a próxima cobrança"
          }.`,
        );
      } else {
        toast.success(`Plano alterado para ${alvo.name}.`);
      }
      router.refresh();
    });
  }

  function desfazerAgendamento() {
    start(async () => {
      const res = await cancelarTrocaDePlano({});
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success("Troca de plano cancelada. Você segue no plano atual.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Trocar de plano</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {pendingPlan && (
          <div className="flex flex-col gap-2 rounded-lg border border-info/40 bg-info/5 p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="min-w-0 text-sm [overflow-wrap:anywhere]">
              <CalendarClock className="mr-1 inline size-4 text-info" />
              Agendado: <b>{pendingPlan.name}</b> a partir de{" "}
              <b>{formatDate(pendingPlan.from)}</b>.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              onClick={desfazerAgendamento}
              disabled={pending}
            >
              <Undo2 className="size-4" /> Cancelar troca
            </Button>
          </div>
        )}

        {outros.map((plan) => (
          <div
            key={plan.id}
            className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="min-w-0 font-semibold [overflow-wrap:anywhere]">{plan.name}</p>
                <span className="text-sm text-muted-foreground">
                  {formatBRL(plan.priceMonthly)}/mês
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {plan.modules.length > 0
                  ? `Inclui: ${plan.modules.join(", ")}`
                  : "Somente recursos básicos"}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              onClick={() => setSelected(plan)}
              disabled={pending || plan.id === pendingPlan?.id}
            >
              <ArrowLeftRight className="size-4" />
              {plan.id === pendingPlan?.id ? "Já agendado" : "Trocar para este"}
            </Button>
          </div>
        ))}
      </CardContent>

      <Dialog open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Trocar para o plano {selected?.name}?</DialogTitle>
            {/*
              Duas mensagens porque são duas regras diferentes, e a tela não sabe
              qual vale: quem decide é o servidor, olhando se a competência já
              está paga. Dizer só "vale imediatamente" seria mentir para metade
              dos casos — e logo para a metade que envolve dinheiro já pago.
            */}
            <DialogDescription>
              O novo valor de{" "}
              <b>{selected ? formatBRL(selected.priceMonthly) : ""}/mês</b> passa a ser
              cobrado na próxima mensalidade — não há cobrança proporcional. Se o mês
              atual já estiver pago, a troca vale a partir da próxima cobrança; até lá
              você segue no plano que pagou.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={confirmar} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Confirmar troca
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
