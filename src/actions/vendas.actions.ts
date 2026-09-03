"use server";

import { withTenantAction } from "@/lib/http/with-action";
import { VendasService } from "@/lib/services/vendas.service";
import { cancelarVendaSchema } from "@/lib/validations/venda";

/**
 * Cancelamento de venda.
 *
 * Server Action e não Route Handler porque é uma ação de tela (um botão com
 * confirmação), não um endpoint. A transação de reversão fica no serviço.
 */
export const cancelarVenda = withTenantAction({
  schema: cancelarVendaSchema,
  handler: (input, ctx) => VendasService.cancelarVenda(input, ctx),
});
