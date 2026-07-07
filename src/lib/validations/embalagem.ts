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
