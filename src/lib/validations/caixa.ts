import { z } from "zod";

export const caixaMovimentoTipoEnum = z.enum([
  "ENTRADA",
  "SAIDA",
  "RETORNO",
  "QUEBRA",
  "SAIDA_HIGIENIZACAO",
  "RETORNO_HIGIENIZACAO",
]);

export const caixaMovimentoSchema = z
  .object({
    type: caixaMovimentoTipoEnum,
    quantity: z.number().int().positive("Quantidade inválida"),
    brokenQty: z.number().int().nonnegative().optional(), // só na ENTRADA
    dirty: z.boolean().optional(), // ENTRADA/QUEBRA: caixa suja (aguardando higienização)
    customerName: z.string().trim().max(120).nullable().optional(),
    supplierName: z.string().trim().max(120).nullable().optional(),
    cleanerName: z.string().trim().max(120).nullable().optional(),
    movementDate: z.string().min(1, "Informe a data"),
    notes: z.string().trim().max(300).nullable().optional(),
  })
  .refine(
    (v) =>
      (v.type !== "SAIDA" && v.type !== "RETORNO") ||
      (v.customerName && v.customerName.length > 0),
    { message: "Informe o cliente", path: ["customerName"] },
  )
  .refine(
    (v) =>
      (v.type !== "SAIDA_HIGIENIZACAO" && v.type !== "RETORNO_HIGIENIZACAO") ||
      (v.cleanerName && v.cleanerName.length > 0),
    { message: "Informe o higienizador", path: ["cleanerName"] },
  );
export type CaixaMovimentoInput = z.infer<typeof caixaMovimentoSchema>;
