"use server";

import { withTenantAction } from "@/lib/http/with-action";
import { CotacoesService } from "@/lib/services/cotacoes.service";
import {
  desvincularSchema,
  escolherCentralSchema,
  vincularSchema,
} from "@/lib/validations/cotacao";

/**
 * Toda action leva `module: "cotacoes"`.
 *
 * O gate de rota do proxy e o do layout cobrem a NAVEGAÇÃO; uma Server Action é
 * um POST que não passa por nenhum dos dois. Sem isto, quem não contratou o
 * módulo não veria a tela, mas conseguiria escrever por ela.
 */

export const escolherCentral = withTenantAction({
  schema: escolherCentralSchema,
  module: "cotacoes",
  handler: (input, ctx) => CotacoesService.escolherCentral(input, ctx),
});

export const vincularCotacao = withTenantAction({
  schema: vincularSchema,
  module: "cotacoes",
  handler: (input, ctx) => CotacoesService.vincular(input, ctx),
});

export const desvincularCotacao = withTenantAction({
  schema: desvincularSchema,
  module: "cotacoes",
  handler: (input, ctx) => CotacoesService.desvincular(input, ctx),
});
