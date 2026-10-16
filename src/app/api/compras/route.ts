import { withTenantRoute } from "@/lib/http/with-route";
import { compraSchema } from "@/lib/validations/compra";
import { ComprasService } from "@/lib/services/compras.service";

export const runtime = "nodejs";

export const POST = withTenantRoute({
  schema: compraSchema,
  handler: async (input, ctx) => {
    const p = await ComprasService.registrarCompra(input, ctx);
    return { id: p.id };
  },
});
