"use server";

import { withTenantAction } from "@/lib/http/with-action";
import { ComprasService } from "@/lib/services/compras.service";
import { cancelarCompraSchema } from "@/lib/validations/compra";

/**
 * Cancelamento de compra lançada errada.
 *
 * Server Action pelo mesmo motivo de `cancelarVenda`: é um botão com
 * confirmação, não um endpoint. A transação de reversão fica no serviço.
 */
export const cancelarCompra = withTenantAction({
  schema: cancelarCompraSchema,
  handler: (input, ctx) => ComprasService.cancelarCompra(input, ctx),
});
