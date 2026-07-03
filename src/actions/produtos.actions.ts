"use server";

import { z } from "zod";
import { withTenantAction } from "@/lib/http/with-action";
import { ProdutosService } from "@/lib/services/produtos.service";
import { produtoSchema, produtoUpdateSchema } from "@/lib/validations/produto";

export const criarProduto = withTenantAction({
  schema: produtoSchema,
  handler: (input, ctx) => ProdutosService.create(input, ctx),
});

export const atualizarProduto = withTenantAction({
  schema: produtoUpdateSchema,
  handler: (input, ctx) => ProdutosService.update(input, ctx),
});

export const excluirProduto = withTenantAction({
  schema: z.string().min(1),
  handler: (id, ctx) => ProdutosService.remove(id, ctx),
});
