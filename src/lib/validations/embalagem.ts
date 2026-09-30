import { z } from "zod";

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
  saleDate: z.string().min(1, "Informe a data"),
  quantity: z.number().int().positive("Quantidade inválida").max(QTD_MAX, QTD_MAX_MSG),
  unitPrice: z.number().nonnegative("Valor inválido"),
});
export type VendaEmbalagemInput = z.infer<typeof vendaEmbalagemSchema>;

/** Liga o controle de estoque de um tipo, informando o que existe hoje. */
export const ativarEstoqueEmbalagemSchema = z.object({
  packagingTypeId: z.string().min(1),
  quantidadeAtual: z.number().int().nonnegative("Quantidade inválida").max(QTD_MAX, QTD_MAX_MSG),
});
export type AtivarEstoqueEmbalagemInput = z.infer<typeof ativarEstoqueEmbalagemSchema>;

/** Entrada de embalagens (compra ou reposição). */
export const entradaEmbalagemSchema = z.object({
  packagingTypeId: z.string().min(1, "Selecione o tipo"),
  quantity: z.number().int().positive("Quantidade inválida").max(QTD_MAX, QTD_MAX_MSG),
  unitCost: z.number().nonnegative("Valor inválido").optional(),
  notes: z.string().trim().max(300).nullable().optional(),
});
export type EntradaEmbalagemInput = z.infer<typeof entradaEmbalagemSchema>;
