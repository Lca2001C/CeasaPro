import { z } from "zod";

export const expenseTypeEnum = z.enum(["FIXA", "VARIAVEL"]);
export const expenseStatusEnum = z.enum(["PENDENTE", "PAGO"]);
export const expensePaymentMethodEnum = z.enum([
  "PIX",
  "DINHEIRO",
  "TRANSFERENCIA",
  "BOLETO",
  "CARTAO",
]);

const dateStr = z.string().trim().min(1).nullable().optional();

const despesaBase = z.object({
  description: z.string().trim().min(1, "Informe a descrição").max(200),
  amount: z.number().positive("Informe o valor"),
  type: expenseTypeEnum,
  status: expenseStatusEnum,
  categoryId: z.string().nullable().optional(),
  paymentMethod: expensePaymentMethodEnum.nullable().optional(),
  dueDate: dateStr,
  paidDate: dateStr,
  /** "Repetir todo mês": ao quitar, a parcela do mês seguinte é gerada sozinha. */
  recurring: z.boolean().optional(),
});

/**
 * Uma despesa marcada como paga PRECISA da data de pagamento.
 *
 * Sem ela a conta não entra no fluxo de caixa nem no relatório de contas pagas:
 * o dinheiro saiu, mas nenhum relatório sabe quando. O formulário preenche a
 * data sozinho ao marcar Pago, então esta regra só barra quem apagou o campo.
 */
const exigePaidDate = <T extends z.ZodType>(schema: T) =>
  schema.refine(
    (v) => {
      const d = v as z.infer<typeof despesaBase>;
      return d.status !== "PAGO" || Boolean(d.paidDate);
    },
    { message: "Informe a data do pagamento", path: ["paidDate"] },
  );

export const despesaSchema = exigePaidDate(despesaBase);
export type DespesaInput = z.infer<typeof despesaBase>;

export const despesaUpdateSchema = exigePaidDate(
  despesaBase.extend({ id: z.string().min(1) }),
);
export type DespesaUpdateInput = DespesaInput & { id: string };

export const categoriaSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome").max(80),
});
export type CategoriaInput = z.infer<typeof categoriaSchema>;

export const categoriaUpdateSchema = categoriaSchema.extend({
  id: z.string().min(1),
});
export type CategoriaUpdateInput = z.infer<typeof categoriaUpdateSchema>;

/** Marcar como pago em um toque, direto da lista. */
export const marcarPagoSchema = z.object({
  id: z.string().min(1),
  /** Opcional: sem data, o serviço usa hoje (no fuso do app). */
  paidDate: dateStr,
  paymentMethod: expensePaymentMethodEnum.nullable().optional(),
});
export type MarcarPagoInput = z.infer<typeof marcarPagoSchema>;

/** Campo de data usado nos filtros e no relatório. */
export const despesaDateFieldEnum = z.enum(["dueDate", "paidDate", "createdAt"]);
export type DespesaDateField = z.infer<typeof despesaDateFieldEnum>;

/** Filtros da listagem — tudo opcional, tudo resolvido no banco. */
export const despesaFiltroSchema = z.object({
  status: expenseStatusEnum.optional(),
  /** Só pendentes com vencimento no passado. */
  vencidas: z.boolean().optional(),
  type: expenseTypeEnum.optional(),
  categoryId: z.string().min(1).optional(),
  /** Busca por descrição (case-insensitive). */
  q: z.string().trim().min(1).max(200).optional(),
  dateField: despesaDateFieldEnum.optional(),
  from: dateStr,
  to: dateStr,
});
export type DespesaFiltro = z.infer<typeof despesaFiltroSchema>;

/** Replicar as despesas de um mês para o mês seguinte. */
export const replicarMesSchema = z.object({
  /** Mês de origem em "YYYY-MM". Vazio = mês anterior ao corrente. */
  origem: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "Mês inválido")
    .optional(),
});
export type ReplicarMesInput = z.infer<typeof replicarMesSchema>;
