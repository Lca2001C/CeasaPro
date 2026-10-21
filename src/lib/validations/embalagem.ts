import { z } from "zod";
import { MSG_DUAS_CASAS, temAteDuasCasas } from "./dinheiro";
import { MSG_VALOR_MAX, VALOR_MAX } from "./quantidade";
import { MSG_DATA_ANTIGA, dataNaoAntesDoMesPassado } from "./venda";

/**
 * Teto de quantidade por lançamento de embalagem.
 *
 * Sem ele, qualquer inteiro positivo passava — e um valor colado por engano
 * (1.500.000.000) cabia na coluna mas, somado a outro, estourava o saldo. Um
 * milhão de unidades num lançamento só já é muito além de qualquer box.
 */
export const QTD_MAX = 1_000_000;
const QTD_MAX_MSG = "Quantidade muito alta — confira o número";

export const tipoEmbalagemSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome").max(80),
});
export type TipoEmbalagemInput = z.infer<typeof tipoEmbalagemSchema>;

export const vendaEmbalagemSchema = z.object({
  packagingTypeId: z.string().min(1, "Selecione o tipo"),
  customerName: z.string().trim().max(120).nullable().optional(),
  saleDate: z
    .string()
    .min(1, "Informe a data")
    .refine((v) => dataNaoAntesDoMesPassado(v), MSG_DATA_ANTIGA),
  quantity: z.number().int().positive("Quantidade inválida").max(QTD_MAX, QTD_MAX_MSG),
  unitPrice: z
    .number()
    .nonnegative("Valor inválido")
    .max(VALOR_MAX, MSG_VALOR_MAX)
    .refine(temAteDuasCasas, MSG_DUAS_CASAS),
  /** Uma por venda digitada: o reenvio devolve a venda já gravada. */
  idempotencyKey: z.uuid().optional(),
});
export type VendaEmbalagemInput = z.infer<typeof vendaEmbalagemSchema>;

/**
 * Custo de UMA embalagem. Até 4 casas: papelão comprado a R$ 10,00 o pacote
 * de 3 custa R$ 3,3333 cada, e arredondar para 2 casas erraria o custo médio.
 */
const custoUnitarioSchema = z
  .number({ message: "Informe quanto custou cada uma" })
  .positive("Informe quanto custou cada uma")
  .max(100_000, "Valor muito alto — confira o número");

/**
 * Liga o controle de estoque de um tipo, informando o que existe hoje.
 *
 * Com saldo inicial, o custo de cada uma é obrigatório (como o estoque inicial
 * de produto): é ele que forma o custo médio que a venda desconta do lucro.
 */
export const ativarEstoqueEmbalagemSchema = z
  .object({
    packagingTypeId: z.string().min(1),
    quantidadeAtual: z.number().int().nonnegative("Quantidade inválida").max(QTD_MAX, QTD_MAX_MSG),
    custoUnitario: custoUnitarioSchema.optional(),
  })
  .refine((v) => v.quantidadeAtual === 0 || v.custoUnitario !== undefined, {
    message: "Informe quanto custou cada uma",
    path: ["custoUnitario"],
  });
export type AtivarEstoqueEmbalagemInput = z.infer<typeof ativarEstoqueEmbalagemSchema>;

/** Entrada de embalagens (compra ou reposição). */
export const entradaEmbalagemSchema = z.object({
  packagingTypeId: z.string().min(1, "Selecione o tipo"),
  quantity: z.number().int().positive("Quantidade inválida").max(QTD_MAX, QTD_MAX_MSG),
  // Obrigatório: sem ele a venda não teria custo e o lucro sairia inflado.
  unitCost: custoUnitarioSchema,
  notes: z.string().trim().max(300).nullable().optional(),
  /** Uma por entrada digitada: o reenvio devolve a entrada já gravada. */
  idempotencyKey: z.uuid().optional(),
});
export type EntradaEmbalagemInput = z.infer<typeof entradaEmbalagemSchema>;

/**
 * Baixa de embalagem que saiu sem ser vendida: rasgou, molhou, foi junto com a
 * mercadoria. Sai pelo custo médio do tipo e entra no custo do mês.
 */
export const baixaEmbalagemSchema = z.object({
  packagingTypeId: z.string().min(1, "Selecione o tipo"),
  quantity: z.number().int().positive("Quantidade inválida").max(QTD_MAX, QTD_MAX_MSG),
  motivo: z.string().trim().min(3, "Diga o motivo da baixa").max(200),
});
export type BaixaEmbalagemInput = z.infer<typeof baixaEmbalagemSchema>;
