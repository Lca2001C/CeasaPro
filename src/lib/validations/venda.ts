import { z } from "zod";

export const paymentMethodEnum = z.enum(["PIX", "DINHEIRO", "CARTAO", "FIADO"]);

export const recipientTypeEnum = z.enum(["PLASTICA", "PAPELAO", "MADEIRA"]);

export const vendaItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().positive("Quantidade inválida"),
  unitPrice: z.number().nonnegative("Preço inválido"),
  recipientType: recipientTypeEnum.nullable().optional(),
  crateQty: z.number().int().nonnegative("Quantidade de caixas inválida").optional(),
});

export const vendaSchema = z
  .object({
    customerName: z.string().trim().max(120).nullable().optional(),
    paymentMethod: paymentMethodEnum,
    saleDate: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    /** Caixas plásticas que saíram na venda. Se omitido, soma os itens PLASTICA. */
    plasticCrateQty: z.number().int().nonnegative("Quantidade de caixas inválida").optional(),
    items: z.array(vendaItemSchema).min(1, "Adicione ao menos um item"),
  })
  .refine((v) => v.paymentMethod !== "FIADO" || (v.customerName && v.customerName.length > 0), {
    message: "Informe o cliente para venda fiada",
    path: ["customerName"],
  })
  .refine((v) => !v.plasticCrateQty || (v.customerName && v.customerName.length > 0), {
    message: "Informe o cliente para controlar as caixas plásticas",
    path: ["customerName"],
  });
export type VendaInput = z.infer<typeof vendaSchema>;
