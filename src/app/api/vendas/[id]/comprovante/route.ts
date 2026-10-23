import { z } from "zod";
import { withTenantRoute } from "@/lib/http/with-route";
import { NotFoundError } from "@/lib/http/app-error";
import { isoDateTz } from "@/lib/tz";
import { buildComprovanteVenda } from "@/lib/reports/comprovante-venda";
import { respostaDeArquivo, trechoDeNomeDeArquivo } from "@/lib/reports/arquivo-exportado";

export const runtime = "nodejs";

const querySchema = z.object({
  format: z.enum(["excel", "pdf"]).default("pdf"),
});

/**
 * GET /api/vendas/<id>/comprovante?format=pdf|excel — o comprovante de UMA
 * venda (cliente, pagamento, itens e total).
 *
 * Núcleo, sem gate de módulo: venda e relatório de vendas são do plano base.
 * A venda é buscada pelo `tenantId` da sessão (`buildComprovanteVenda`), então
 * o id de outra empresa responde 404 como um id que não existe.
 */
export const GET = withTenantRoute({
  schema: querySchema,
  source: "query",
  handler: async (input, ctx) => {
    const parts = new URL(ctx.req.url).pathname.split("/").filter(Boolean);
    const saleId = parts[2] ?? ""; // /api/vendas/<id>/comprovante
    if (!saleId) throw new NotFoundError("Venda não encontrada");

    const result = await buildComprovanteVenda(ctx.tenantId, saleId);
    const cliente = result.cabecalho?.[0]?.valor ?? "venda";
    return respostaDeArquivo({
      result,
      formato: input.format,
      nomeBase: `venda-${trechoDeNomeDeArquivo(cliente)}-${isoDateTz(result.period.from)}`,
      registro: {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        type: "VENDAS",
        filters: { saleId },
      },
    });
  },
});
