"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";
import { despesaSchema, type DespesaInput } from "@/lib/validations/despesa";
import { criarDespesa, atualizarDespesa } from "@/actions/despesas.actions";
import {
  EXPENSE_PAYMENT_METHOD_LABELS,
  EXPENSE_STATUS_LABELS,
  EXPENSE_TYPE_LABELS,
  toOptions,
} from "@/lib/labels";
import { isoDateTz } from "@/lib/tz";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { CurrencyInput } from "@/components/forms/currency-input";

interface Props {
  categories: { id: string; name: string }[];
  initial?: DespesaInput & { id: string };
  /** Valores para uma despesa NOVA já preenchida (duplicar / "igual à última"). */
  preenchido?: DespesaInput;
}

export function DespesaForm({ categories, initial, preenchido }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const hoje = isoDateTz();
  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm<DespesaInput>({
    resolver: zodResolver(despesaSchema),
    defaultValues:
      initial ??
      preenchido ?? {
        description: "",
        type: "VARIAVEL",
        status: "PENDENTE",
        recurring: false,
      },
  });

  // `useWatch` em vez de `watch()`: o `watch` devolve uma função nova a cada
  // render e faz o React Compiler desistir de memoizar o formulário inteiro.
  const status = useWatch({ control, name: "status" });
  const dueDate = useWatch({ control, name: "dueDate" });
  const paidDate = useWatch({ control, name: "paidDate" });
  const type = useWatch({ control, name: "type" });

  /**
   * Marcar "Pago" já preenche a data do pagamento com hoje.
   *
   * Sem isso dava para salvar uma despesa paga SEM data — e aí ela não entra no
   * fluxo de caixa nem no relatório de contas pagas: o dinheiro saiu e nenhum
   * relatório sabe quando. O schema também exige a data; isto é o que evita que
   * a exigência virasse um erro de formulário no caminho comum.
   */
  useEffect(() => {
    if (status === "PAGO" && !paidDate) setValue("paidDate", hoje);
    if (status === "PENDENTE" && paidDate) setValue("paidDate", null);
  }, [status, paidDate, hoje, setValue]);

  // Aviso (não erro): lançar conta com vencimento no passado às vezes é
  // intencional — "estou cadastrando a conta de julho agora".
  const vencimentoNoPassado = Boolean(!initial && dueDate && dueDate < hoje);

  async function onSubmit(values: DespesaInput) {
    setSaving(true);
    const res = initial
      ? await atualizarDespesa({ ...values, id: initial.id })
      : await criarDespesa(values);
    setSaving(false);
    if (res.ok) {
      toast.success(initial ? "Despesa atualizada" : "Despesa cadastrada");
      router.push("/despesas");
      router.refresh();
    } else {
      toast.error(res.error.message);
    }
  }

  const nullIfEmpty = { setValueAs: (v: string) => (v === "" ? null : v) };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Descrição</Label>
        <Input id="description" autoFocus {...register("description")} />
        {errors.description && (
          <span className="text-xs text-destructive">{errors.description.message}</span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Valor</Label>
        <Controller
          control={control}
          name="amount"
          render={({ field }) => (
            <CurrencyInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} />
          )}
        />
        {errors.amount && <span className="text-xs text-destructive">{errors.amount.message}</span>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="type">Tipo</Label>
          <Select id="type" {...register("type")}>
            {toOptions(EXPENSE_TYPE_LABELS).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="status">Situação</Label>
          <Select id="status" {...register("status")}>
            {toOptions(EXPENSE_STATUS_LABELS).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="categoryId">Categoria</Label>
          <Select id="categoryId" defaultValue="" {...register("categoryId", nullIfEmpty)}>
            <option value="">— Sem categoria —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="paymentMethod">Forma de pagamento</Label>
          <Select
            id="paymentMethod"
            defaultValue=""
            {...register("paymentMethod", nullIfEmpty)}
          >
            <option value="">— Não informado —</option>
            {toOptions(EXPENSE_PAYMENT_METHOD_LABELS).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dueDate">Vencimento</Label>
          <Input id="dueDate" type="date" {...register("dueDate", nullIfEmpty)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="paidDate">Pagamento</Label>
          <Input
            id="paidDate"
            type="date"
            disabled={status === "PENDENTE"}
            {...register("paidDate", nullIfEmpty)}
          />
          {errors.paidDate && (
            <span className="text-xs text-destructive">{errors.paidDate.message}</span>
          )}
        </div>
      </div>

      {vencimentoNoPassado && (
        <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          O vencimento escolhido já passou. A conta vai nascer como <b>vencida</b> — se for uma
          conta antiga que você está registrando agora, está tudo certo.
        </p>
      )}

      {/* Fixa de verdade: aluguel, INSS e pró-labore não deveriam ser
          relançados à mão todo mês. */}
      <label className="flex items-start gap-2 rounded-lg border p-3 text-sm">
        <input type="checkbox" className="mt-0.5 size-4" {...register("recurring")} />
        <span>
          <b>Repetir todo mês</b>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Ao quitar esta conta, a do mês seguinte é criada automaticamente como pendente, no
            mesmo dia do vencimento. Precisa de um vencimento informado.
            {type === "FIXA" ? "" : " Comum em contas fixas (aluguel, INSS, pró-labore)."}
          </span>
        </span>
      </label>

      <div className="flex gap-2 pt-2">
        <Button type="button" variant="ghost" className="flex-1" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button type="submit" className="flex-1" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          Salvar
        </Button>
      </div>
    </form>
  );
}
