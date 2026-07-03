import { z } from "zod";

export const pagamentoFiadoSchema = z.object({
  accountId: z.string().min(1),
  amount: z.number().positive("Informe o valor"),
  method: z.enum(["PIX", "DINHEIRO", "CARTAO"]),
});
export type PagamentoFiadoInput = z.infer<typeof pagamentoFiadoSchema>;
