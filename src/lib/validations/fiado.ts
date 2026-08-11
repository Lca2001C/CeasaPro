import { z } from "zod";
import { vendaItemSchema } from "./venda";

export const pagamentoFiadoSchema = z.object({
  accountId: z.string().min(1),
  amount: z.number().positive("Informe o valor"),
  method: z.enum(["PIX", "DINHEIRO", "CARTAO"]),
});
export type PagamentoFiadoInput = z.infer<typeof pagamentoFiadoSchema>;

/** Lançamento manual de uma venda fiada (venda que não passou pelo PDV). */
export const fiadoManualSchema = z.object({
  customerName: z.string().trim().min(1, "Informe o cliente").max(120),
  customerPhone: z.string().trim().max(20).nullable().optional(),
  saleDate: z.string().min(1, "Informe a data da venda"),
  dueDate: z.string().nullable().optional(),
  plasticCrateQty: z.number().int().nonnegative("Quantidade de caixas inválida").optional(),
  notes: z.string().trim().max(300).nullable().optional(),
  items: z.array(vendaItemSchema).min(1, "Adicione ao menos um item"),
});
export type FiadoManualInput = z.infer<typeof fiadoManualSchema>;

/** Só dados cadastrais — valores nunca são editados aqui. */
export const fiadoUpdateSchema = z.object({
  id: z.string().min(1),
  customerPhone: z.string().trim().max(20).nullable().optional(),
  dueDate: z.string().nullable().optional(),
  notes: z.string().trim().max(300).nullable().optional(),
});
export type FiadoUpdateInput = z.infer<typeof fiadoUpdateSchema>;

export const devolucaoCaixasSchema = z.object({
  accountId: z.string().min(1),
  quantity: z.number().int().positive("Quantidade inválida"),
  movementDate: z.string().min(1, "Informe a data"),
  notes: z.string().trim().max(300).nullable().optional(),
});
export type DevolucaoCaixasInput = z.infer<typeof devolucaoCaixasSchema>;

export const fiadoStatusFiltroEnum = z.enum(["EM_ABERTO", "PAGO", "TODAS"]);
export type FiadoStatusFiltro = z.infer<typeof fiadoStatusFiltroEnum>;
