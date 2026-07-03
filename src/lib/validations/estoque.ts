import { z } from "zod";

export const ajusteEstoqueSchema = z.object({
  productId: z.string().min(1, "Selecione o produto"),
  type: z.enum(["QUEBRA", "DOACAO", "AJUSTE"]),
  quantity: z.number().positive("Quantidade inválida"),
  reason: z.string().trim().max(200).nullable().optional(),
  unitCost: z.number().nonnegative().nullable().optional(),
});
export type AjusteEstoqueInput = z.infer<typeof ajusteEstoqueSchema>;
