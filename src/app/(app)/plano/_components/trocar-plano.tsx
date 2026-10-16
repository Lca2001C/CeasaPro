"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, ArrowLeftRight, CalendarClock, Layers, Undo2 } from "lucide-react";
import { toast } from "sonner";
import type { AvailablePlan, PlanoView } from "@/lib/services/plano.service";
import { trocarPlano, cancelarTrocaDePlano } from "@/actions/plano.actions";
import { apiPost } from "@/lib/api-client";
import { formatBRL, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconeRedondo } from "@/components/ui/icone-redondo";
import { chamarAction } from "@/lib/http/chamar-action";
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
      const res = await chamarAction(() => trocarPlano({ planId: alvo.id }));
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
      const res = await chamarAction(() => cancelarTrocaDePlano({}));
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success("Troca de plano cancelada. Você segue no plano atual.");
      router.refresh();
    });
  }

  return (
    <section>
      <h2 className="mb-2 px-1 text-sm font-semibold text-muted-foreground">Trocar de plano</h2>
      <div className="flex flex-col gap-2">
        {pendingPlan && (
          <Card className="flex flex-col gap-3 border-info/40 bg-info/10 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <IconeRedondo tom="info" tamanho="sm">
                <CalendarClock />
              </IconeRedondo>
              <p className="min-w-0 self-center text-sm [overflow-wrap:anywhere]">
                Agendado: <b>{pendingPlan.name}</b> a partir de{" "}
                <b>{formatDate(pendingPlan.from)}</b>.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="w-full shrink-0 sm:w-auto"
              onClick={desfazerAgendamento}
              disabled={pending}
            >
              <Undo2 className="size-4" /> Cancelar troca
            </Button>
          </Card>
        )}

        {outros.map((plan) => (
          <Card
            key={plan.id}
            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 items-start gap-3">
              <IconeRedondo tom="neutro">
                <Layers />
              </IconeRedondo>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
                  <p className="min-w-0 font-semibold [overflow-wrap:anywhere]">{plan.name}</p>
                  <span className="font-bold tabular-nums">
                    {formatBRL(plan.priceMonthly)}/mês
                  </span>
                </div>
                <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                  {plan.modules.length > 0
                    ? `Inclui: ${plan.modules.join(", ")}`
                    : "Somente recursos básicos"}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="w-full shrink-0 sm:w-auto"
              onClick={() => setSelected(plan)}
              disabled={pending || plan.id === pendingPlan?.id}
            >
              <ArrowLeftRight className="size-4" />
              {plan.id === pendingPlan?.id ? "Já agendado" : "Trocar para este"}
            </Button>
          </Card>
        ))}
      </div>

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
              {pending ? <Loader2 className="size-4 motion-safe:animate-spin" /> : <Check className="size-4" />}
              Confirmar troca
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
