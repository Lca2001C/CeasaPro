import { z } from "zod";

export const higienizacaoSchema = z.object({
  cleanerName: z.string().trim().min(1, "Informe o higienizador").max(120),
  sentDate: z.string().min(1, "Informe a data de envio"),
  sentQty: z.number().int().positive("Quantidade inválida"),
  unitPrice: z.number().nonnegative("Valor inválido"),
  notes: z.string().trim().max(300).nullable().optional(),
});
export type HigienizacaoInput = z.infer<typeof higienizacaoSchema>;

export const higienizacaoDevolucaoSchema = z.object({
  id: z.string().min(1),
  quantity: z.number().int().positive("Quantidade inválida"),
  returnedDate: z.string().min(1, "Informe a data"),
});
export type HigienizacaoDevolucaoInput = z.infer<typeof higienizacaoDevolucaoSchema>;

export const higienizacaoPagamentoSchema = z.object({
  id: z.string().min(1),
  amount: z.number().positive("Informe o valor"),
  paidDate: z.string().min(1, "Informe a data"),
});
export type HigienizacaoPagamentoInput = z.infer<typeof higienizacaoPagamentoSchema>;
