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

/** Liga/desliga o acesso de um usuário (revoga as sessões ao desligar). */
export const alterarStatusUsuario = withAdminAction({
  schema: z.object({ userId: z.string().min(1), active: z.boolean() }),
  handler: (input, ctx) => AdminService.setUserActive(input, ctx),
});

/** Gera senha temporária e força a troca no próximo login. */
export const resetarSenhaUsuario = withAdminAction({
  schema: z.string().min(1),
  handler: (id, ctx) => AdminService.resetUserPassword(id, ctx),
});

export const criarPlano = withAdminAction({
  schema: planoSchema,
  handler: (input, ctx) => AdminService.createPlan(input, ctx),
});

export const atualizarPlano = withAdminAction({
  schema: planoUpdateSchema,
  handler: (input, ctx) => AdminService.updatePlan(input, ctx),
});

/**
 * Exclui um plano. `apagarHistoricoDeExcluidas` só é aceito quando nenhuma
 * empresa ATIVA usa o plano — ver `deletePlan`.
 */
export const excluirPlano = withAdminAction({
  schema: z.object({
    id: z.string().min(1),
    apagarHistoricoDeExcluidas: z.boolean().optional(),
  }),
  handler: (input, ctx) =>
    AdminService.deletePlan(input.id, ctx, {
      apagarHistoricoDeExcluidas: input.apagarHistoricoDeExcluidas,
    }),
});

/** Exclui um usuário (soft delete) e derruba as sessões dele. */
export const excluirUsuario = withAdminAction({
  schema: z.string().min(1),
  handler: (id, ctx) => AdminService.deleteUser(id, ctx),
});
