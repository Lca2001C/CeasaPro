import { withTenantRoute } from "@/lib/http/with-route";
import { vendaSchema } from "@/lib/validations/venda";
import { VendasService } from "@/lib/services/vendas.service";

export const runtime = "nodejs";

export const POST = withTenantRoute({
  schema: vendaSchema,
  handler: async (input, ctx) => {
    const sale = await VendasService.registrarVenda(input, ctx);
    // `jaRegistrada` diz que esta requisicao foi uma RETENTATIVA da mesma venda
    // (mesma chave de idempotencia), nao uma venda nova. O PDV usa isso para
    // nao mostrar um resumo calculado sobre o carrinho atual, que descreveria
    // uma venda diferente da que ficou gravada.
    return { id: sale.id, jaRegistrada: sale.jaRegistrada };
  },
});
