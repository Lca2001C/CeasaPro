import { z } from "zod";
import { emailSchema } from "./auth";
import { OPTIONAL_MODULE_KEYS } from "@/lib/plan/modules";

export const novaEmpresaSchema = z.object({
  tradeName: z.string().trim().min(1, "Informe o nome da empresa").max(120),
  legalName: z.string().trim().max(160).nullable().optional(),
  cnpj: z.string().trim().max(20).nullable().optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  ownerName: z.string().trim().min(1, "Informe o nome do responsavel").max(120),
  ownerEmail: emailSchema,
  planId: z.string().min(1, "Selecione o plano"),
  monthlyAmount: z.number().nonnegative("Valor invalido"),
  // Nao existe trial: a empresa nasce SUSPENSA e so libera apos o 1o pagamento.
  // `graceDays` e a tolerancia pos-vencimento e so vale depois da 1a ativacao.
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
  active: z.boolean(),
  modules: z.array(z.enum(OPTIONAL_MODULE_KEYS)),
});
export type PlanoInput = z.infer<typeof planoSchema>;

export const planoUpdateSchema = planoSchema.extend({ id: z.string().min(1) });
export type PlanoUpdateInput = z.infer<typeof planoUpdateSchema>;
