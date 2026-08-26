"use server";

import { z } from "zod";
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

export const excluirEmpresa = withAdminAction({
  schema: z.string().min(1),
  handler: (id, ctx) => AdminService.deleteTenant(id, ctx),
});

export const alterarMensalidade = withAdminAction({
  schema: monthlyAmountSchema,
  handler: (input, ctx) =>
    AdminService.updateMonthlyAmount(input.tenantId, input.monthlyAmount, ctx),
});

/**
 * Provisiona (na primeira vez) e abre o ambiente próprio do super-admin.
 * A sessão precisa ser reemitida logo depois: o `tenantId` entra no token, e
 * sem isso o proxy continuaria mandando o admin de volta para `/admin`.
 */
export const abrirMeuAmbiente = withAdminAction({
  handler: (_input, ctx) => AdminService.getOrCreateAdminWorkspace(ctx),
});

export const criarPlano = withAdminAction({
  schema: planoSchema,
  handler: (input) => AdminService.createPlan(input),
});

export const atualizarPlano = withAdminAction({
  schema: planoUpdateSchema,
  handler: (input) => AdminService.updatePlan(input),
});

/** Exclui um plano — só se nenhuma assinatura o usa (ver `deletePlan`). */
export const excluirPlano = withAdminAction({
  schema: z.string().min(1),
  handler: (id, ctx) => AdminService.deletePlan(id, ctx),
});
