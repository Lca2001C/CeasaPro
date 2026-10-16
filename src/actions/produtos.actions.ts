"use server";

import { z } from "zod";
import { withTenantAction } from "@/lib/http/with-action";
import { ProdutosService } from "@/lib/services/produtos.service";
import { ProdutoImagemService } from "@/lib/services/produto-imagem.service";
import { CatalogoImagensService } from "@/lib/services/catalogo-imagens.service";
import {
  fotoProdutoSchema,
  produtoSchema,
  produtoUpdateSchema,
} from "@/lib/validations/produto";

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

/**
 * Foto tirada na câmera ou escolhida na galeria, já comprimida no aparelho.
 * Devolve a chave que o formulário grava no produto ao salvar.
 */
export const enviarFotoProduto = withTenantAction({
  schema: fotoProdutoSchema,
  handler: (input, ctx) => ProdutoImagemService.enviarDaEmpresa(ctx.tenantId, input.base64),
});

/** "Banco": fotos da plataforma, filtradas pelo nome digitado. */
export const buscarFotosDoBanco = withTenantAction({
  schema: z.object({ q: z.string().trim().max(80).optional() }),
  handler: (input) => CatalogoImagensService.buscar(input.q),
});
