import { z } from "zod";

export const expenseTypeEnum = z.enum(["FIXA", "VARIAVEL"]);
export const expenseStatusEnum = z.enum(["PENDENTE", "PAGO"]);

const dateStr = z.string().trim().min(1).nullable().optional();

export const despesaSchema = z.object({
  description: z.string().trim().min(1, "Informe a descrição").max(200),
  amount: z.number().positive("Informe o valor"),
  type: expenseTypeEnum,
  status: expenseStatusEnum,
  categoryId: z.string().nullable().optional(),
  dueDate: dateStr,
  paidDate: dateStr,
});
export type DespesaInput = z.infer<typeof despesaSchema>;

export const despesaUpdateSchema = despesaSchema.extend({ id: z.string().min(1) });
export type DespesaUpdateInput = z.infer<typeof despesaUpdateSchema>;

export const categoriaSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome").max(80),
});
export type CategoriaInput = z.infer<typeof categoriaSchema>;
