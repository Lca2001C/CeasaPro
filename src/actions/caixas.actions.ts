"use server";

import { z } from "zod";
import { withTenantAction } from "@/lib/http/with-action";
import { CaixasService } from "@/lib/services/caixas.service";
import { caixaMovimentoSchema } from "@/lib/validations/caixa";

export const registrarMovimentoCaixa = withTenantAction({
  schema: caixaMovimentoSchema,
  module: "caixas",
  handler: async (input, ctx) => {
    const mov = await CaixasService.registrar(input, ctx);
    return { id: mov.id, type: mov.type };
  },
});

/** Desfaz a entrada de caixas lançada errada (até 24 h). Ver `CaixasService.desfazerEntrada`. */
export const desfazerEntradaCaixa = withTenantAction({
  schema: z.object({ id: z.string().min(1) }),
  module: "caixas",
  handler: (input, ctx) => CaixasService.desfazerEntrada(input, ctx),
});
