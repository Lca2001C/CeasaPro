import { withTenantRoute } from "@/lib/http/with-route";
import { fiadoManualSchema } from "@/lib/validations/fiado";
import { FiadoService } from "@/lib/services/fiado.service";

export const runtime = "nodejs";

/** Lançamento manual de venda fiada (transacional → Route Handler). */
export const POST = withTenantRoute({
  schema: fiadoManualSchema,
  handler: async (input, ctx) => {
    const conta = await FiadoService.create(input, ctx);
    return { id: conta.id };
  },
});
