import { z } from "zod";
<<<<<<< HEAD
import { emailSchema } from "./auth";
=======
import { OPTIONAL_MODULE_KEYS } from "@/lib/plan/modules";
>>>>>>> 3dd6880 (feat/adicionando teste e CI/CD)

export const novaEmpresaSchema = z.object({
  tradeName: z.string().trim().min(1, "Informe o nome da empresa").max(120),
  legalName: z.string().trim().max(160).nullable().optional(),
  cnpj: z.string().trim().max(20).nullable().optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  ownerName: z.string().trim().min(1, "Informe o nome do responsavel").max(120),
  ownerEmail: emailSchema,
  planId: z.string().min(1, "Selecione o plano"),
  monthlyAmount: z.number().nonnegative("Valor invalido"),
  trialDays: z.number().int().nonnegative(),
  graceDays: z.number().int().nonnegative(),
});
export type NovaEmpresaInput = z.infer<typeof novaEmpresaSchema>;

export const tenantStatusSchema = z.object({
  tenantId: z.string().min(1),
  status: z.enum(["ACTIVE", "SUSPENDED", "BLOCKED"]),
  reason: z.string().max(200).nullable().optional(),
});
export type TenantStatusInput = z.infer<typeof tenantStatusSchema>;

export const monthlyAmountSchema = z.object({
  tenantId: z.string().min(1),
  monthlyAmount: z.number().nonnegative(),
});

export const planoSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome").max(80),
  priceMonthly: z.number().nonnegative("Valor invalido"),
  maxUsers: z.number().int().positive().nullable().optional(),
  active: z.boolean(),
  modules: z.array(z.enum(OPTIONAL_MODULE_KEYS)),
});
export type PlanoInput = z.infer<typeof planoSchema>;

export const planoUpdateSchema = planoSchema.extend({ id: z.string().min(1) });
export type PlanoUpdateInput = z.infer<typeof planoUpdateSchema>;
