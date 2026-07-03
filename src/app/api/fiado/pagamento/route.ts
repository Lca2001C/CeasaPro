import { withTenantRoute } from "@/lib/http/with-route";
import { pagamentoFiadoSchema } from "@/lib/validations/fiado";
import { FiadoService } from "@/lib/services/fiado.service";

export const runtime = "nodejs";

export const POST = withTenantRoute({
  schema: pagamentoFiadoSchema,
  handler: async (input, ctx) => {
    const acc = await FiadoService.registrarPagamento(input, ctx);
    return { id: acc.id, status: acc.status };
  },
});
