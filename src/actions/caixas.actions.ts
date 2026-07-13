"use server";

import { withTenantAction } from "@/lib/http/with-action";
import { CaixasService } from "@/lib/services/caixas.service";
import { caixaMovimentoSchema } from "@/lib/validations/caixa";

export const registrarMovimentoCaixa = withTenantAction({
  schema: caixaMovimentoSchema,
  module: "caixas",
  handler: (input, ctx) => CaixasService.registrar(input, ctx),
});
