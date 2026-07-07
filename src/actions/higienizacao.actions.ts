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
  handler: (input, ctx) => HigienizacaoService.create(input, ctx),
});

export const registrarDevolucaoHigienizacao = withTenantAction({
  schema: higienizacaoDevolucaoSchema,
  handler: (input, ctx) => HigienizacaoService.registrarDevolucao(input, ctx),
});

export const registrarPagamentoHigienizacao = withTenantAction({
  schema: higienizacaoPagamentoSchema,
  handler: (input, ctx) => HigienizacaoService.registrarPagamento(input, ctx),
});

export const excluirHigienizacao = withTenantAction({
  schema: z.string().min(1),
  handler: (id, ctx) => HigienizacaoService.remove(id, ctx),
});
