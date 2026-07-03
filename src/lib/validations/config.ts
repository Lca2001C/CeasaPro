import { z } from "zod";

export const empresaSchema = z.object({
  tradeName: z.string().trim().min(1, "Informe o nome").max(120),
  legalName: z.string().trim().max(160).nullable().optional(),
  cnpj: z.string().trim().max(20).nullable().optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  address: z.string().trim().max(200).nullable().optional(),
  businessHours: z.string().trim().max(120).nullable().optional(),
});
export type EmpresaInput = z.infer<typeof empresaSchema>;
