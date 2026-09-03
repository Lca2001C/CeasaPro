"use server";

import { z } from "zod";
import { withTenantAction } from "@/lib/http/with-action";
import { DespesasService } from "@/lib/services/despesas.service";
import {
  despesaSchema,
  despesaUpdateSchema,
  categoriaSchema,
  categoriaUpdateSchema,
  marcarPagoSchema,
  replicarMesSchema,
} from "@/lib/validations/despesa";

export const criarDespesa = withTenantAction({
  schema: despesaSchema,
  handler: (input, ctx) => DespesasService.create(input, ctx),
});

export const atualizarDespesa = withTenantAction({
  schema: despesaUpdateSchema,
  handler: (input, ctx) => DespesasService.update(input, ctx),
});

export const excluirDespesa = withTenantAction({
  schema: z.string().min(1),
  handler: (id, ctx) => DespesasService.remove(id, ctx),
});

/** Um toque na lista: quita a conta com a data de hoje. */
export const marcarDespesaComoPaga = withTenantAction({
  schema: marcarPagoSchema,
  handler: async (input, ctx) => {
    const e = await DespesasService.marcarComoPago(input, ctx);
    return { id: e.id, status: e.status };
  },
});

export const marcarDespesaComoPendente = withTenantAction({
  schema: z.string().min(1),
  handler: async (id, ctx) => {
    const e = await DespesasService.marcarComoPendente(id, ctx);
    return { id: e.id, status: e.status };
  },
});

/** Copia as contas de um mês para o seguinte (controle manual da recorrência). */
export const replicarMesDeDespesas = withTenantAction({
  schema: replicarMesSchema,
  handler: (input, ctx) => DespesasService.replicarMes(input.origem, ctx),
});

export const criarCategoriaDespesa = withTenantAction({
  schema: categoriaSchema,
  handler: (input, ctx) => DespesasService.createCategory(input, ctx),
});

export const renomearCategoriaDespesa = withTenantAction({
  schema: categoriaUpdateSchema,
  handler: (input, ctx) => DespesasService.renameCategory(input, ctx),
});

export const excluirCategoriaDespesa = withTenantAction({
  schema: z.string().min(1),
  handler: (id, ctx) => DespesasService.removeCategory(id, ctx),
});
