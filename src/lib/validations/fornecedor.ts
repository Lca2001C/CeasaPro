import { z } from "zod";

export const fornecedorSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome").max(120, "Até 120 caracteres"),
  phone: z.string().trim().max(20, "Telefone muito longo").nullable().optional(),
  address: z.string().trim().max(200, "Até 200 caracteres").nullable().optional(),
  notes: z.string().trim().max(500, "Até 500 caracteres").nullable().optional(),
  active: z.boolean(),
});
export type FornecedorInput = z.infer<typeof fornecedorSchema>;

export const fornecedorUpdateSchema = fornecedorSchema.extend({
  id: z.string().min(1),
});
export type FornecedorUpdateInput = z.infer<typeof fornecedorUpdateSchema>;
