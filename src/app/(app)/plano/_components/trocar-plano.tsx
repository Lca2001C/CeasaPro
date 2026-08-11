"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, ArrowLeftRight } from "lucide-react";
import { toast } from "sonner";
import type { AvailablePlan } from "@/lib/services/plano.service";
import { trocarPlano } from "@/actions/plano.actions";
import { apiPost } from "@/lib/api-client";
import { formatBRL } from "@/lib/format";
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

export function TrocarPlano({ plans }: { plans: AvailablePlan[] }) {
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
      toast.success(`Plano alterado para ${alvo.name}.`);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Trocar de plano</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {outros.map((plan) => (
          <div
            key={plan.id}
            className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <p className="font-semibold">{plan.name}</p>
                <span className="text-sm text-muted-foreground">
                  {formatBRL(plan.priceMonthly)}/mês
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {plan.maxUsers ? `Até ${plan.maxUsers} usuário(s)` : "Usuários ilimitados"}
                {plan.modules.length > 0
                  ? ` · Inclui: ${plan.modules.join(", ")}`
                  : " · Somente recursos básicos"}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              onClick={() => setSelected(plan)}
            >
              <ArrowLeftRight className="size-4" /> Trocar para este
            </Button>
          </div>
        ))}
      </CardContent>

      <Dialog open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Trocar para o plano {selected?.name}?</DialogTitle>
            <DialogDescription>
              A mudança vale imediatamente. O novo valor de{" "}
              <b>{selected ? formatBRL(selected.priceMonthly) : ""}/mês</b> será cobrado na{" "}
              próxima renovação — o período já pago não é alterado.
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
