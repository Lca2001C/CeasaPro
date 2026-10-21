import { z } from "zod";
import { MSG_DUAS_CASAS, temAteDuasCasas } from "./dinheiro";
import { MSG_VALOR_MAX, VALOR_MAX } from "./quantidade";

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
  // 2 casas e teto: R$ 0,004 gravava uma conta "positiva" de R$ 0,00, e um
  // número gigante estourava a coluna como erro 500.
  amount: z
    .number()
    .positive("Informe o valor")
    .max(VALOR_MAX, MSG_VALOR_MAX)
    .refine(temAteDuasCasas, MSG_DUAS_CASAS),
  type: expenseTypeEnum,
  status: expenseStatusEnum,
  categoryId: z.string().nullable().optional(),
  paymentMethod: expensePaymentMethodEnum.nullable().optional(),
  dueDate: dateStr,
  paidDate: dateStr,
  /** "Repetir todo mês": ao quitar, a parcela do mês seguinte é gerada sozinha. */
  recurring: z.boolean().optional(),
  /** A quem a conta é devida (opcional). */
  supplierId: z.string().min(1).nullable().optional(),
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

/**
 * Recorte por origem na lista: a conta que veio de uma COMPRA (mercadoria —
 * já está no CMV) ou a OPERACIONAL (aluguel, luz… — entra no lucro).
 */
export const despesaOrigemFiltroEnum = z.enum(["COMPRA", "OPERACIONAL"]);
export type DespesaOrigemFiltro = z.infer<typeof despesaOrigemFiltroEnum>;

/** Filtros da listagem — tudo opcional, tudo resolvido no banco. */
export const despesaFiltroSchema = z.object({
  origem: despesaOrigemFiltroEnum.optional(),
  supplierId: z.string().min(1).optional(),
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
