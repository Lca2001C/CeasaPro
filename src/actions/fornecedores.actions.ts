"use server";

import { z } from "zod";
import { withTenantAction } from "@/lib/http/with-action";
import { FornecedoresService } from "@/lib/services/fornecedores.service";
import {
  fornecedorSchema,
  fornecedorUpdateSchema,
} from "@/lib/validations/fornecedor";

export const criarFornecedor = withTenantAction({
  schema: fornecedorSchema,
  handler: (input, ctx) => FornecedoresService.create(input, ctx),
});

export const atualizarFornecedor = withTenantAction({
  schema: fornecedorUpdateSchema,
  handler: (input, ctx) => FornecedoresService.update(input, ctx),
});

export const excluirFornecedor = withTenantAction({
  schema: z.string().min(1),
  handler: (id, ctx) => FornecedoresService.remove(id, ctx),
});
