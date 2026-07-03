"use server";

import { withAdminAction } from "@/lib/http/with-action";
import { AdminService } from "@/lib/services/admin.service";
import {
  novaEmpresaSchema,
  tenantStatusSchema,
  monthlyAmountSchema,
  planoSchema,
  planoUpdateSchema,
} from "@/lib/validations/admin";

export const criarEmpresa = withAdminAction({
  schema: novaEmpresaSchema,
  handler: (input, ctx) => AdminService.createTenantWithOwner(input, ctx),
});

export const alterarStatusEmpresa = withAdminAction({
  schema: tenantStatusSchema,
  handler: (input, ctx) => AdminService.setTenantStatus(input, ctx),
});

export const alterarMensalidade = withAdminAction({
  schema: monthlyAmountSchema,
  handler: (input, ctx) =>
    AdminService.updateMonthlyAmount(input.tenantId, input.monthlyAmount, ctx),
});

export const criarPlano = withAdminAction({
  schema: planoSchema,
  handler: (input) => AdminService.createPlan(input),
});

export const atualizarPlano = withAdminAction({
  schema: planoUpdateSchema,
  handler: (input) => AdminService.updatePlan(input),
});
