import { Prisma } from "@prisma/client";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { money, toDecimal } from "@/lib/money";
import { FinancialCalc } from "./financial-calc.service";

/**
 * Clientes = quem aparece nas vendas.
 *
 * Não há cadastro de cliente: a identidade é o NOME, sem caixa e sem espaços
 * nas pontas — a mesma regra do fiado (`AvisosService`, "clientes distintos").
 * Assim a aba nasce com o histórico inteiro, sem migração de dados, e nunca
 * discorda do fiado sobre quem é quem. O PDV já autocompleta o nome
 * (`clientesConhecidos`) para o mesmo cliente não virar dois.
 *
 * SQL cru leva o `tenantId` explícito, como no resto dos serviços.
 */

/** Chave do cliente na URL e nas consultas. */
export function chaveDoCliente(nome: string): string {
  return nome.trim().toLocaleLowerCase("pt-BR");
}

export interface ClienteResumo {
  chave: string;
  nome: string;
  telefone: string | null;
  compras: number;
  totalComprado: Prisma.Decimal;
  ultimaCompra: Date;
  aguardandoRetirada: number;
}

export const ClientesService = {
  async list(tenantId: string, q?: string): Promise<ClienteResumo[]> {
    const busca = q?.trim() ? `%${q.trim().toLocaleLowerCase("pt-BR")}%` : null;
    const rows = await getTenantPrisma(tenantId).$queryRaw<
      {
        chave: string;
        nome: string;
        telefone: string | null;
        compras: bigint;
        total: Prisma.Decimal | string;
        ultima: Date;
        aguardando: bigint;
      }[]
    >`
      SELECT lower(btrim("customerName")) AS chave,
             -- A grafia mais recente é a que o dono usa hoje.
             (array_agg(btrim("customerName") ORDER BY "saleDate" DESC))[1] AS nome,
             (array_agg("customerPhone" ORDER BY "saleDate" DESC)
                FILTER (WHERE "customerPhone" IS NOT NULL AND "customerPhone" <> ''))[1] AS telefone,
             COUNT(*) AS compras,
             COALESCE(SUM("totalAmount"), 0) AS total,
             MAX("saleDate") AS ultima,
             COUNT(*) FILTER (WHERE "retirarDepois" AND "retiradoEm" IS NULL) AS aguardando
      FROM sales
      WHERE "tenantId" = ${tenantId}
        AND "deletedAt" IS NULL
        AND "cancelledAt" IS NULL
        AND "customerName" IS NOT NULL
        AND btrim("customerName") <> ''
        AND (${busca}::text IS NULL OR lower("customerName") LIKE ${busca})
      GROUP BY lower(btrim("customerName"))
      ORDER BY MAX("saleDate") DESC
      LIMIT 500
    `;
    return rows.map((r) => ({
      chave: r.chave,
      nome: r.nome,
      telefone: r.telefone,
      compras: Number(r.compras),
      totalComprado: money(toDecimal(r.total as Prisma.Decimal.Value)),
      ultimaCompra: r.ultima,
      aguardandoRetirada: Number(r.aguardando),
    }));
  },

  /** Ficha do cliente: todas as compras (com itens) e o fiado em aberto. */
  async detalhe(tenantId: string, chave: string) {
    const db = getTenantPrisma(tenantId);
    const ids = await getTenantPrisma(tenantId).$queryRaw<{ id: string }[]>`
      SELECT id FROM sales
      WHERE "tenantId" = ${tenantId}
        AND "deletedAt" IS NULL
        AND lower(btrim("customerName")) = ${chave}
    `;
    if (ids.length === 0) return null;

    const [vendas, contas] = await Promise.all([
      db.sale.findMany({
        where: { id: { in: ids.map((r) => r.id) } },
        include: {
          items: {
            include: { product: { select: { name: true, imageKey: true, saleUnit: true } } },
            orderBy: { createdAt: "asc" },
          },
          payments: true,
        },
        orderBy: { saleDate: "desc" },
      }),
      db.creditAccount.findMany({
        where: { saleId: { in: ids.map((r) => r.id) }, status: "EM_ABERTO" },
        select: { totalAmount: true, paidAmount: true },
      }),
    ]);

    const vivas = vendas.filter((v) => v.cancelledAt === null);
    const total = vivas.reduce((a, v) => a.plus(v.totalAmount), new Prisma.Decimal(0));
    const fiadoEmAberto = FinancialCalc.saldoFiado(
      contas.reduce((a, c) => a.plus(c.totalAmount), new Prisma.Decimal(0)),
      contas.reduce((a, c) => a.plus(c.paidAmount), new Prisma.Decimal(0)),
    );
    const maisRecente = vendas[0]!;
    return {
      nome: maisRecente.customerName!.trim(),
      telefone: vendas.find((v) => v.customerPhone)?.customerPhone ?? null,
      vendas,
      compras: vivas.length,
      totalComprado: money(total),
      ticketMedio: money(vivas.length > 0 ? total.div(vivas.length) : new Prisma.Decimal(0)),
      fiadoEmAberto: money(fiadoEmAberto),
      aguardandoRetirada: vivas.filter((v) => v.retirarDepois && v.retiradoEm === null).length,
    };
  },
};
