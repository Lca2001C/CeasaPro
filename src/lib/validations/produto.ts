import { z } from "zod";

export const saleUnitEnum = z.enum(["CAIXA", "KG", "SACO", "BANDEJA", "UNIDADE"]);
export const recipientTypeEnum = z.enum(["PLASTICA", "PAPELAO", "MADEIRA"]);

export const produtoSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do produto").max(120),
  saleUnit: saleUnitEnum,
  qtyPerRecipient: z.number().positive("Valor inválido").nullable().optional(),
  recipientType: recipientTypeEnum.nullable().optional(),
  sackCapacity: z.number().positive("Valor inválido").nullable().optional(),
  active: z.boolean(),
});
export type ProdutoInput = z.infer<typeof produtoSchema>;

export const produtoUpdateSchema = produtoSchema.extend({
  id: z.string().min(1),
});
export type ProdutoUpdateInput = z.infer<typeof produtoUpdateSchema>;

export const idSchema = z.object({ id: z.string().min(1) });
