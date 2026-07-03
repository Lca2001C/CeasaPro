import { z } from "zod";
import { recipientTypeEnum } from "./produto";

export const compraItemSchema = z.object({
  productId: z.string().min(1, "Selecione o produto"),
  quantity: z.number().positive("Quantidade inválida"),
  unitPrice: z.number().nonnegative("Preço inválido"),
  recipientType: recipientTypeEnum.nullable().optional(),
  suggestedSalePrice: z.number().nonnegative().nullable().optional(),
});

export const compraSchema = z.object({
  supplierId: z.string().nullable().optional(),
  purchaseDate: z.string().min(1, "Informe a data"),
  freight: z.number().nonnegative(),
  notes: z.string().max(500).nullable().optional(),
  items: z.array(compraItemSchema).min(1, "Adicione ao menos um item"),
});
export type CompraInput = z.infer<typeof compraSchema>;
