import { withTenantRoute } from "@/lib/http/with-route";
import { PushInscricaoService } from "@/lib/services/push-inscricao.service";
import { pushSubscribeSchema, pushUnsubscribeSchema } from "@/lib/validations/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/pwa/push` — registra a inscrição deste aparelho.
 * `DELETE /api/pwa/push` — remove a inscrição deste aparelho.
 *
 * As regras (upsert pelo endpoint, escopo por usuário) estão em
 * `PushInscricaoService`, onde são testáveis. Aqui só a borda HTTP.
 */
export const POST = withTenantRoute({
  schema: pushSubscribeSchema,
  handler: (input, ctx) =>
    PushInscricaoService.registrar(
      { userId: ctx.userId, tenantId: ctx.tenantId },
      input,
      ctx.req.headers.get("user-agent")?.slice(0, 255) ?? null,
    ),
});

export const DELETE = withTenantRoute({
  schema: pushUnsubscribeSchema,
  handler: (input, ctx) => PushInscricaoService.remover({ userId: ctx.userId }, input),
});
