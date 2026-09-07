import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit";
import { BusinessRuleError, NotFoundError } from "@/lib/http/app-error";
import { sugerirVinculos } from "@/lib/cotacoes/nome";
import type { TenantCtx } from "@/lib/http/with-action";

/**
 * Leitura das cotações e gestão dos vínculos.
 *
 * As tabelas de central, produto do boletim e cotação são GLOBAIS — o preço da
 * central é o mesmo para todo mundo que compra ali — então são lidas pelo
 * `prisma` cru, como `rate_limits`. O escopo de empresa entra por dois caminhos
 * explícitos: a central que a empresa escolheu (`tenant.ceasaCentralCode`) e os
 * vínculos dela (`tenant_ceasa_links`, que passa pela extensão multi-tenant).
 */

export interface LinhaDeCotacao {
  ceasaProductId: string;
  ceasaProductName: string;
  unit: string;
  refPrice: Prisma.Decimal | null;
  minPrice: Prisma.Decimal | null;
  maxPrice: Prisma.Decimal | null;
  /** Produto do cliente vinculado a esta cotação, se houver. */
  meuProdutoId: string | null;
  meuProdutoNome: string | null;
  /** Saldo do produto vinculado. Null quando não há vínculo. */
  meuSaldo: Prisma.Decimal | null;
}

export interface PainelDeCotacoes {
  central: { code: string; name: string; city: string; uf: string } | null;
  /** Data do BOLETIM mostrado. Null quando ainda não há cotação nenhuma. */
  quoteDate: Date | null;
  linhas: LinhaDeCotacao[];
  /** Produtos do cliente que ainda não têm vínculo — a lista de tarefas do módulo. */
  semVinculo: { id: string; name: string }[];
}

export const CotacoesService = {
  /** Centrais que a empresa pode escolher. */
  async listarCentrais() {
    return prisma.ceasaCentral.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { code: true, name: true, city: true, uf: true },
    });
  },

  /**
   * Tudo que a tela de cotações precisa.
   *
   * Uma consulta para as cotações (com o vínculo e o saldo por LEFT JOIN) e uma
   * para os produtos sem vínculo. O filtro por texto e a separação entre "meus"
   * e "todos" acontecem em memória, como em `estoque/page.tsx`: o volume é o de
   * um boletim (algumas centenas de linhas), e ir ao banco a cada tecla custaria
   * mais que filtrar aqui.
   */
  async getPainel(tenantId: string): Promise<PainelDeCotacoes> {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        ceasaCentral: { select: { code: true, name: true, city: true, uf: true } },
      },
    });
    const central = tenant?.ceasaCentral ?? null;
    if (!central) return { central: null, quoteDate: null, linhas: [], semVinculo: [] };

    // A data do boletim MAIS RECENTE desta central. Sem isso a tela misturaria
    // dias diferentes na mesma lista, e o preço de um produto seria de ontem
    // enquanto o do vizinho seria de uma semana atrás — sem nada indicando isso.
    const ultima = await prisma.ceasaQuote.aggregate({
      where: { centralCode: central.code },
      _max: { quoteDate: true },
    });
    const quoteDate = ultima._max.quoteDate ?? null;
    if (!quoteDate) {
      return { central, quoteDate: null, linhas: [], semVinculo: await semVinculo(tenantId) };
    }

    const rows = await prisma.$queryRaw<
      {
        ceasaProductId: string;
        ceasaProductName: string;
        unit: string;
        refPrice: Prisma.Decimal | string | null;
        minPrice: Prisma.Decimal | string | null;
        maxPrice: Prisma.Decimal | string | null;
        meuProdutoId: string | null;
        meuProdutoNome: string | null;
        meuSaldo: Prisma.Decimal | string | null;
      }[]
    >`
      SELECT cp.id            AS "ceasaProductId",
             cp.name          AS "ceasaProductName",
             q.unit           AS unit,
             q."refPrice"     AS "refPrice",
             q."minPrice"     AS "minPrice",
             q."maxPrice"     AS "maxPrice",
             p.id             AS "meuProdutoId",
             p.name           AS "meuProdutoNome",
             saldo.quantity   AS "meuSaldo"
      FROM ceasa_quotes q
      JOIN ceasa_products cp ON cp.id = q."ceasaProductId"
      LEFT JOIN tenant_ceasa_links l
             ON l."ceasaProductId" = cp.id AND l."tenantId" = ${tenantId}
      LEFT JOIN products p
             ON p.id = l."productId" AND p."deletedAt" IS NULL AND p.active = true
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(CASE WHEN m.type IN ('ENTRADA','AJUSTE') THEN m.quantity ELSE -m.quantity END), 0) AS quantity
        FROM stock_movements m
        WHERE m."productId" = p.id AND m."tenantId" = ${tenantId}
      ) saldo ON p.id IS NOT NULL
      WHERE q."centralCode" = ${central.code} AND q."quoteDate" = ${quoteDate}
      ORDER BY cp.name ASC, q.unit ASC
    `;

    return {
      central,
      quoteDate,
      linhas: rows.map((r) => ({
        ceasaProductId: r.ceasaProductId,
        ceasaProductName: r.ceasaProductName,
        unit: r.unit,
        refPrice: dec(r.refPrice),
        minPrice: dec(r.minPrice),
        maxPrice: dec(r.maxPrice),
        meuProdutoId: r.meuProdutoId,
        meuProdutoNome: r.meuProdutoNome,
        meuSaldo: r.meuProdutoId ? (dec(r.meuSaldo) ?? null) : null,
      })),
      semVinculo: await semVinculo(tenantId),
    };
  },

  /**
   * Tela de vínculo: os produtos do cliente, o vínculo atual de cada um e as
   * sugestões ordenadas.
   *
   * As sugestões NUNCA são aplicadas sozinhas — ver `sugerirVinculos`.
   */
  async getTelaDeVinculo(tenantId: string) {
    const [meus, links, doBoletim] = await Promise.all([
      prisma.product.findMany({
        where: { tenantId, deletedAt: null, active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.tenantCeasaLink.findMany({
        where: { tenantId },
        select: { productId: true, ceasaProduct: { select: { id: true, name: true } } },
      }),
      prisma.ceasaProduct.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);

    const porProduto = new Map(links.map((l) => [l.productId, l.ceasaProduct]));

    return {
      doBoletim,
      produtos: meus.map((p) => ({
        id: p.id,
        name: p.name,
        vinculo: porProduto.get(p.id) ?? null,
        sugestoes: porProduto.has(p.id)
          ? []
          : sugerirVinculos(p.name, doBoletim, (c) => c.name).map((s) => s.item),
      })),
    };
  },

  async escolherCentral(input: { centralCode: string | null }, ctx: TenantCtx) {
    if (input.centralCode) {
      const existe = await prisma.ceasaCentral.findFirst({
        where: { code: input.centralCode, active: true },
        select: { code: true },
      });
      if (!existe) throw new NotFoundError("Central não encontrada.");
    }
    await prisma.tenant.update({
      where: { id: ctx.tenantId },
      data: { ceasaCentralCode: input.centralCode },
    });
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "UPDATE",
      entity: "Tenant",
      entityId: ctx.tenantId,
      newData: { ceasaCentralCode: input.centralCode },
      ip: ctx.ip,
    });
  },

  async vincular(input: { productId: string; ceasaProductId: string }, ctx: TenantCtx) {
    const [meu, doBoletim] = await Promise.all([
      prisma.product.findFirst({
        where: { id: input.productId, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true, name: true },
      }),
      prisma.ceasaProduct.findUnique({
        where: { id: input.ceasaProductId },
        select: { id: true, name: true },
      }),
    ]);
    // O produto é conferido CONTRA O TENANT: sem isso, um id de outra empresa
    // criaria vínculo cruzado — a única superfície do módulo em que isso seria
    // possível, já que o resto é dado público.
    if (!meu) throw new NotFoundError("Produto não encontrado.");
    if (!doBoletim) throw new NotFoundError("Produto do boletim não encontrado.");

    const link = await prisma.tenantCeasaLink.upsert({
      where: { tenantId_productId: { tenantId: ctx.tenantId, productId: meu.id } },
      create: { tenantId: ctx.tenantId, productId: meu.id, ceasaProductId: doBoletim.id },
      update: { ceasaProductId: doBoletim.id },
    });
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "UPDATE",
      entity: "TenantCeasaLink",
      entityId: link.id,
      newData: { produto: meu.name, cotacao: doBoletim.name },
      ip: ctx.ip,
    });
    return link;
  },

  async desvincular(input: { productId: string }, ctx: TenantCtx) {
    const r = await prisma.tenantCeasaLink.deleteMany({
      where: { tenantId: ctx.tenantId, productId: input.productId },
    });
    if (r.count === 0) throw new BusinessRuleError("Este produto não estava vinculado.");
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "DELETE",
      entity: "TenantCeasaLink",
      entityId: input.productId,
      ip: ctx.ip,
    });
  },
};

/** Produtos ativos da empresa que ainda não apontam para nenhuma cotação. */
async function semVinculo(tenantId: string) {
  return prisma.product.findMany({
    where: { tenantId, deletedAt: null, active: true, ceasaLinks: { none: {} } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

function dec(v: Prisma.Decimal | string | null): Prisma.Decimal | null {
  if (v === null || v === undefined) return null;
  return v as Prisma.Decimal;
}
