import { z } from "zod";

/** Central escolhida pela empresa. `null` = voltar a não ter central. */
export const escolherCentralSchema = z.object({
  centralCode: z.string().trim().min(1).max(20).nullable(),
});
export type EscolherCentralInput = z.infer<typeof escolherCentralSchema>;

export const vincularSchema = z.object({
  productId: z.string().min(1, "Informe o produto"),
  ceasaProductId: z.string().min(1, "Escolha a cotação correspondente"),
});
export type VincularInput = z.infer<typeof vincularSchema>;

export const desvincularSchema = z.object({
  productId: z.string().min(1, "Informe o produto"),
});
export type DesvincularInput = z.infer<typeof desvincularSchema>;
