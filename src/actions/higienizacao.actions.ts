"use server";

import { z } from "zod";
import { withTenantAction } from "@/lib/http/with-action";
import { HigienizacaoService } from "@/lib/services/higienizacao.service";
import {
  higienizacaoSchema,
  higienizacaoDevolucaoSchema,
  higienizacaoPagamentoSchema,
} from "@/lib/validations/higienizacao";

export const criarHigienizacao = withTenantAction({
  schema: higienizacaoSchema,
  module: "higienizacao",
  handler: (input, ctx) => HigienizacaoService.create(input, ctx),
});

export const registrarDevolucaoHigienizacao = withTenantAction({
  schema: higienizacaoDevolucaoSchema,
  module: "higienizacao",
  handler: (input, ctx) => HigienizacaoService.registrarDevolucao(input, ctx),
});

export const registrarPagamentoHigienizacao = withTenantAction({
  schema: higienizacaoPagamentoSchema,
  module: "higienizacao",
  handler: (input, ctx) => HigienizacaoService.registrarPagamento(input, ctx),
});

export const excluirHigienizacao = withTenantAction({
  schema: z.string().min(1),
  module: "higienizacao",
  handler: (id, ctx) => HigienizacaoService.remove(id, ctx),
});
