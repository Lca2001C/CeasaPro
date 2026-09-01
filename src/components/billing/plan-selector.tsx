"use client";

import { Check } from "lucide-react";
import type { AvailablePlan } from "@/lib/services/plano.service";
import { formatBRL } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";

/**
 * Escolha do plano ANTES do pagamento.
 *
 * Existe porque a empresa recém-criada nasce suspensa e o proxy só a deixa
 * abrir `/assinatura` — `/plano`, onde fica a troca de plano, é área bloqueada.
 * Sem isto o primeiro pagamento era sempre no plano que o super-admin escolheu
 * no cadastro, sem o cliente ter como opinar.
 *
 * O `planId` escolhido acompanha o checkout; quem troca a assinatura de fato é
 * o servidor (`BillingService.prepareCharge` → `PlanoService.changePlan`), que
 * também define o valor cobrado. O preço aqui é só exibição.
 */
export function PlanSelector({
  plans,
  selectedId,
  onSelect,
  disabled,
  primeiraAtivacao,
}: {
  plans: AvailablePlan[];
  selectedId: string | null;
  onSelect: (planId: string) => void;
  /** Trava a escolha enquanto uma cobrança está sendo criada. */
  disabled?: boolean;
  primeiraAtivacao: boolean;
}) {
  if (plans.length < 2) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          {primeiraAtivacao ? "Escolha o seu plano" : "Plano da mensalidade"}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {plans.map((plan) => {
          const selected = plan.id === selectedId;
          return (
            <label
              key={plan.id}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                selected ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                disabled && "pointer-events-none opacity-60",
              )}
            >
              <input
                type="radio"
                name="plano"
                className="mt-1 size-4 shrink-0 accent-primary"
                checked={selected}
                disabled={disabled}
                onChange={() => onSelect(plan.id)}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold">{plan.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {formatBRL(plan.priceMonthly)}/mês
                  </span>
                  {plan.isCurrent && !primeiraAtivacao && (
                    <span className="text-xs text-muted-foreground">(atual)</span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {plan.modules.length > 0
                    ? ` · Inclui: ${plan.modules.join(", ")}`
                    : " · Somente recursos básicos"}
                </span>
              </span>
              {selected && <Check className="mt-1 size-4 shrink-0 text-primary" />}
            </label>
          );
        })}
        <p className="text-xs text-muted-foreground">
          O plano escolhido passa a valer assim que o pagamento for aprovado. Depois você
          pode trocar quando quiser em <b>Meu plano</b>.
        </p>
      </CardContent>
    </Card>
  );
}
