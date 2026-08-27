"use server";

import { z } from "zod";
import { withTenantAction } from "@/lib/http/with-action";
import { EmbalagensService } from "@/lib/services/embalagens.service";
import {
  ativarEstoqueEmbalagemSchema,
  entradaEmbalagemSchema,
  tipoEmbalagemSchema,
  vendaEmbalagemSchema,
} from "@/lib/validations/embalagem";

export const criarTipoEmbalagem = withTenantAction({
  schema: tipoEmbalagemSchema,
  module: "embalagens",
  handler: (input, ctx) => EmbalagensService.createType(input, ctx),
});

export const criarVendaEmbalagem = withTenantAction({
  schema: vendaEmbalagemSchema,
  module: "embalagens",
  handler: (input, ctx) => EmbalagensService.createSale(input, ctx),
});

export const excluirVendaEmbalagem = withTenantAction({
  schema: z.string().min(1),
  module: "embalagens",
  handler: (id, ctx) => EmbalagensService.removeSale(id, ctx),
});

/** Liga o controle de saldo de um tipo, gravando o que existe hoje. */
export const ativarEstoqueEmbalagem = withTenantAction({
  schema: ativarEstoqueEmbalagemSchema,
  module: "embalagens",
  handler: (input, ctx) => EmbalagensService.ativarControleEstoque(input, ctx),
});

/** Entrada de embalagens (compra ou reposição). */
export const registrarEntradaEmbalagem = withTenantAction({
  schema: entradaEmbalagemSchema,
  module: "embalagens",
  handler: async (input, ctx) => {
    const mov = await EmbalagensService.registrarEntrada(input, ctx);
    return { id: mov.id, quantity: mov.quantity };
  },
});
