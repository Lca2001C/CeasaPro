import { withTenantRoute } from "@/lib/http/with-route";
import { vendaSchema } from "@/lib/validations/venda";
import { VendasService } from "@/lib/services/vendas.service";

export const runtime = "nodejs";

export const POST = withTenantRoute({
  schema: vendaSchema,
  handler: async (input, ctx) => {
    const sale = await VendasService.registrarVenda(input, ctx);
    return { id: sale.id };
  },
});
