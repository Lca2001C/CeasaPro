"use server";

import { withTenantAction } from "@/lib/http/with-action";
import { VendasService } from "@/lib/services/vendas.service";
import { cancelarVendaSchema, marcarRetiradaSchema } from "@/lib/validations/venda";

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

/** Checkbox "Buscado" da lista de vendas. */
export const marcarRetirada = withTenantAction({
  schema: marcarRetiradaSchema,
  handler: (input, ctx) => VendasService.marcarRetirada(input, ctx),
});
