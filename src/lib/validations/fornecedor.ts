import { z } from "zod";

export const fornecedorSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome").max(120),
  phone: z.string().trim().max(20).nullable().optional(),
  address: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  active: z.boolean(),
});
export type FornecedorInput = z.infer<typeof fornecedorSchema>;

export const fornecedorUpdateSchema = fornecedorSchema.extend({
  id: z.string().min(1),
});
export type FornecedorUpdateInput = z.infer<typeof fornecedorUpdateSchema>;
