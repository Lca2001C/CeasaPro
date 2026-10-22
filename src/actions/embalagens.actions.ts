"use server";

import { z } from "zod";
import { withTenantAction } from "@/lib/http/with-action";
import { EmbalagensService } from "@/lib/services/embalagens.service";
import {
  ativarEstoqueEmbalagemSchema,
  entradaEmbalagemSchema,
  baixaEmbalagemSchema,
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

/** Desfaz a entrada lançada errada (até 24 h). Ver `EmbalagensService.desfazerEntrada`. */
export const desfazerEntradaEmbalagem = withTenantAction({
  schema: z.object({ id: z.string().min(1) }),
  module: "embalagens",
  handler: (input, ctx) => EmbalagensService.desfazerEntrada(input, ctx),
});

/** Desfaz a baixa lançada errada (até 24 h). Ver `EmbalagensService.desfazerBaixa`. */
export const desfazerBaixaEmbalagem = withTenantAction({
  schema: z.object({ id: z.string().min(1) }),
  module: "embalagens",
  handler: (input, ctx) => EmbalagensService.desfazerBaixa(input, ctx),
});

/** Cancela a venda lançada errada (até 24 h). Ver `EmbalagensService.cancelarVenda`. */
export const cancelarVendaEmbalagem = withTenantAction({
  schema: z.object({
    id: z.string().min(1),
    motivo: z.string().trim().max(200).nullable().optional(),
  }),
  module: "embalagens",
  handler: (input, ctx) => EmbalagensService.cancelarVenda(input, ctx),
});

/** Liga o controle de saldo de um tipo, gravando o que existe hoje. */
export const ativarEstoqueEmbalagem = withTenantAction({
  schema: ativarEstoqueEmbalagemSchema,
  module: "embalagens",
  handler: (input, ctx) => EmbalagensService.ativarControleEstoque(input, ctx),
});

/** Baixa de embalagem que não foi vendida (quebra, uso). Ver `EmbalagensService.registrarBaixa`. */
export const registrarBaixaEmbalagem = withTenantAction({
  schema: baixaEmbalagemSchema,
  module: "embalagens",
  handler: async (input, ctx) => {
    const mov = await EmbalagensService.registrarBaixa(input, ctx);
    return { id: mov.id, quantity: mov.quantity };
  },
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
