"use server";

import { z } from "zod";
import { withAdminAction } from "@/lib/http/with-action";
import { CatalogoImagensService } from "@/lib/services/catalogo-imagens.service";
import { fotoProdutoSchema } from "@/lib/validations/produto";

const nome = z.string().trim().min(1, "Informe o nome").max(80);

export const criarFotoDoBanco = withAdminAction({
  schema: fotoProdutoSchema.extend({ nome }),
  handler: (input, ctx) => CatalogoImagensService.criar(input, ctx),
});

export const atualizarFotoDoBanco = withAdminAction({
  schema: z.object({ id: z.string().min(1), nome, ativo: z.boolean() }),
  handler: (input, ctx) => CatalogoImagensService.atualizar(input, ctx),
});

export const excluirFotoDoBanco = withAdminAction({
  schema: z.string().min(1),
  handler: (id, ctx) => CatalogoImagensService.excluir(id, ctx),
});
