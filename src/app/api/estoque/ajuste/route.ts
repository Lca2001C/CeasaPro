import { withTenantRoute } from "@/lib/http/with-route";
import { ajusteEstoqueSchema } from "@/lib/validations/estoque";
import { EstoqueService } from "@/lib/services/estoque.service";

export const runtime = "nodejs";

export const POST = withTenantRoute({
  schema: ajusteEstoqueSchema,
  handler: async (input, ctx) => {
    const m = await EstoqueService.registrarAjuste(input, ctx);
    return { id: m.id };
  },
});
