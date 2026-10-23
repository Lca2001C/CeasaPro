import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { chaveDoCliente } from "@/lib/services/clientes.service";

/**
 * As vendas VIVAS de um cliente no período, com os itens — o extrato do
 * relatório de vendas e a lista de comprovantes da tela.
 *
 * O cliente é a IDENTIDADE do nome (`chaveDoCliente`: sem caixa nem espaços
 * nas pontas), a mesma da aba Clientes e do fiado: "João" e " joão " são uma
 * pessoa só. Por isso os ids saem de SQL (`lower(btrim())`), como em
 * `ClientesService.detalhe`; o `tenantId` vai explícito no `where`.
 *
 * Cancelada fica de fora: não é venda do período (o comprovante dela continua
 * disponível pela própria venda).
 */
export async function vendasDoCliente(tenantId: string, cliente: string, from: Date, to: Date) {
  const db = getTenantPrisma(tenantId);
  const chave = chaveDoCliente(cliente);
  const ids = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM sales
    WHERE "tenantId" = ${tenantId}
      AND "deletedAt" IS NULL
      AND "cancelledAt" IS NULL
      AND lower(btrim("customerName")) = ${chave}
      AND "saleDate" >= ${from} AND "saleDate" <= ${to}
  `;
  if (ids.length === 0) return [];
  return db.sale.findMany({
    where: { id: { in: ids.map((r) => r.id) } },
    include: {
      items: {
        include: { product: { select: { name: true, saleUnit: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { saleDate: "asc" },
  });
}

/**
 * Como o cliente aparece no título: a grafia da venda viva mais recente (de
 * qualquer período), como na aba Clientes. Sem venda nenhuma, o próprio texto.
 */
export async function nomeDoCliente(tenantId: string, cliente: string): Promise<string> {
  const chave = chaveDoCliente(cliente);
  const [linha] = await getTenantPrisma(tenantId).$queryRaw<{ nome: string }[]>`
    SELECT btrim("customerName") AS nome FROM sales
    WHERE "tenantId" = ${tenantId}
      AND "deletedAt" IS NULL
      AND lower(btrim("customerName")) = ${chave}
    -- A grafia de uma venda viva vence a de uma cancelada, como na aba Clientes.
    ORDER BY ("cancelledAt" IS NULL) DESC, "saleDate" DESC
    LIMIT 1
  `;
  return linha?.nome ?? cliente.trim();
}
