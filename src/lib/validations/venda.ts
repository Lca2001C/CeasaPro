import { z } from "zod";

export const paymentMethodEnum = z.enum(["PIX", "DINHEIRO", "CARTAO", "FIADO"]);

export const vendaItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().positive("Quantidade inválida"),
  unitPrice: z.number().nonnegative("Preço inválido"),
});

export const vendaSchema = z
  .object({
    customerName: z.string().trim().max(120).nullable().optional(),
    paymentMethod: paymentMethodEnum,
    dueDate: z.string().nullable().optional(),
    items: z.array(vendaItemSchema).min(1, "Adicione ao menos um item"),
  })
  .refine((v) => v.paymentMethod !== "FIADO" || (v.customerName && v.customerName.length > 0), {
    message: "Informe o cliente para venda fiada",
    path: ["customerName"],
  });
export type VendaInput = z.infer<typeof vendaSchema>;
