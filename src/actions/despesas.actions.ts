"use server";

import { z } from "zod";
import { withTenantAction } from "@/lib/http/with-action";
import { DespesasService } from "@/lib/services/despesas.service";
import {
  despesaSchema,
  despesaUpdateSchema,
  categoriaSchema,
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

export const criarCategoriaDespesa = withTenantAction({
  schema: categoriaSchema,
  handler: (input, ctx) => DespesasService.createCategory(input, ctx),
});
