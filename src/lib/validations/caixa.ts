import { z } from "zod";

export const caixaMovimentoTipoEnum = z.enum(["ENTRADA", "SAIDA", "RETORNO", "QUEBRA"]);

export const caixaMovimentoSchema = z
  .object({
    type: caixaMovimentoTipoEnum,
    quantity: z.number().int().positive("Quantidade inválida"),
    brokenQty: z.number().int().nonnegative().optional(), // só na ENTRADA
    customerName: z.string().trim().max(120).nullable().optional(),
    supplierName: z.string().trim().max(120).nullable().optional(),
    movementDate: z.string().min(1, "Informe a data"),
    notes: z.string().trim().max(300).nullable().optional(),
  })
  .refine(
    (v) =>
      (v.type !== "SAIDA" && v.type !== "RETORNO") ||
      (v.customerName && v.customerName.length > 0),
    { message: "Informe o cliente", path: ["customerName"] },
  );
export type CaixaMovimentoInput = z.infer<typeof caixaMovimentoSchema>;
