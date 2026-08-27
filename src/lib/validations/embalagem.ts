import { z } from "zod";

export const tipoEmbalagemSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome").max(80),
});
export type TipoEmbalagemInput = z.infer<typeof tipoEmbalagemSchema>;

export const vendaEmbalagemSchema = z.object({
  packagingTypeId: z.string().min(1, "Selecione o tipo"),
  customerName: z.string().trim().max(120).nullable().optional(),
  saleDate: z.string().min(1, "Informe a data"),
  quantity: z.number().int().positive("Quantidade inválida"),
  unitPrice: z.number().nonnegative("Valor inválido"),
});
export type VendaEmbalagemInput = z.infer<typeof vendaEmbalagemSchema>;

/** Liga o controle de estoque de um tipo, informando o que existe hoje. */
export const ativarEstoqueEmbalagemSchema = z.object({
  packagingTypeId: z.string().min(1),
  quantidadeAtual: z.number().int().nonnegative("Quantidade inválida"),
});
export type AtivarEstoqueEmbalagemInput = z.infer<typeof ativarEstoqueEmbalagemSchema>;

/** Entrada de embalagens (compra ou reposição). */
export const entradaEmbalagemSchema = z.object({
  packagingTypeId: z.string().min(1, "Selecione o tipo"),
  quantity: z.number().int().positive("Quantidade inválida"),
  unitCost: z.number().nonnegative("Valor inválido").optional(),
  notes: z.string().trim().max(300).nullable().optional(),
});
export type EntradaEmbalagemInput = z.infer<typeof entradaEmbalagemSchema>;
