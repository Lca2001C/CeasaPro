import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { toDecimal, money } from "@/lib/money";
import { FinancialCalc } from "./financial-calc.service";
import { EstoqueService } from "./estoque.service";
import { startOfDay, startOfMonth, addDays, endOfDay } from "@/lib/dates";
import { APP_TIME_ZONE, isoDateTz, startOfNextMonthTz } from "@/lib/tz";
import { isModuleEnabled } from "@/lib/plan/modules";
import { linhasVendidas, resumirPor, type LinhaVendida } from "@/lib/reports/linhas-vendidas";
import { HIGIENIZACAO_ZERADA, resumoDaHigienizacao } from "./despesas.service";

/**
 * Higienização do mês para o painel: saldo em aberto, o que SAIU do caixa no
 * mês (soma dos pagamentos por `paidAt`) e o custo dos envios do mês.
 *
 * Tudo somado no banco. Antes o painel carregava todos os lotes da história e
 * somava o `paidAmount` ACUMULADO pela data do ÚLTIMO pagamento: lote de
 * R$ 300 pago 100 em agosto e 200 em setembro contava R$ 0 em agosto e R$ 300
 * em setembro, e o "Sobrou no mês" de setembro saía R$ 100 abaixo do real.
 */
function higienizacaoDoMes(tenantId: string, inicio: Date, fim: Date) {
  return resumoDaHigienizacao(tenantId, { inicio, fim }, startOfDay(new Date()));
}

export interface DashboardProductRow {
  productId: string;
  name: string;
  quantity: Prisma.Decimal;
  total: Prisma.Decimal;
  profit: Prisma.Decimal;
}

export interface DashboardIdleProduct {
  productId: string;
  name: string;
  quantity: Prisma.Decimal;
  lastMovementAt: Date | null;
}

export interface DashboardSummary {
  hojeVendi: Prisma.Decimal;
  semanaVendi: Prisma.Decimal;
  mesVendi: Prisma.Decimal;
  totalCompradoMes: Prisma.Decimal;
  aReceber: Prisma.Decimal;
  contasPagar: Prisma.Decimal;
  estoqueValor: Prisma.Decimal;
  lucroBrutoMes: Prisma.Decimal;
  lucroMes: Prisma.Decimal;
  margemLiquidaMes: Prisma.Decimal;
  despesasFixasMes: Prisma.Decimal;
  despesasVariaveisMes: Prisma.Decimal;
  topVendidos: DashboardProductRow[];
  topLucrativos: DashboardProductRow[];
  produtosComPrejuizo: DashboardProductRow[];
  estoqueParado: DashboardIdleProduct[];
  chart: { date: string; total: number }[];
}

export const DashboardService = {
  async getSummary(tenantId: string, modules?: string[]): Promise<DashboardSummary> {
    const db = getTenantPrisma(tenantId);
    const now = new Date();
    const todayStart = startOfDay(now);
    const weekStart = startOfDay(addDays(now, -6));
    const monthStart = startOfMonth(now);
    const chartStart = startOfDay(addDays(now, -29));
    const idleCutoff = startOfDay(addDays(now, -30));

    // TETO das janelas — faltava, e a ausência não era inofensiva.
    //
    // As parcelas recorrentes do mês SEGUINTE são geradas ao quitar a atual
    // (`gerarProximaParcela`), com `dueDate` em outubro. Sem teto,
    // `COALESCE("dueDate","createdAt") >= monthStart` as somava no mês de
    // setembro: com dez contas fixas de R$ 500, o lucro do mês aparecia
    // R$ 5.000 abaixo do real — e não fechava com `DespesasService.resumoMes`,
    // que sempre usou `{gte, lte}`. O mesmo valia para venda e compra com data
    // futura, que entravam em "hoje vendi".
    //
    // O limite é "até agora", o mesmo que `resolvePeriod({preset:"mes"})` usa.
    const ateAgora = endOfDay(now);

    // Despesa tem teto DIFERENTE: o fim do mês, não "até agora".
    //
    // Venda e compra com data futura não são faturamento realizado, então
    // para elas o teto "até agora" está certo. Despesa não: a conta fixa que
    // vence dia 20 é despesa DESTE mês desde o dia 1º. Com o teto em "hoje",
    // no dia 8 o painel dizia "Contas fixas R$ 0,00" e um "Sobrou no mês"
    // R$ 5.000 acima do real, enquanto /despesas mostrava "Fixas R$ 5.000,00"
    // no mesmo instante — e o lucro ia "piorando" conforme os vencimentos
    // chegavam, sem nada ter acontecido. O dono do box decide preço com esse
    // número.
    //
    // O comentário acima dizia que o teto existia para fechar com
    // `DespesasService.resumoMes`; era o contrário — `resumoMes` usa o mês
    // INTEIRO (`limitesDoMes`). Fechar de verdade é terminar no fim do mês, o
    // que preserva a correção original: a parcela recorrente de outubro,
    // gerada em setembro, continua fora de setembro.
    const fimDoMes = new Date(startOfNextMonthTz(now).getTime() - 1);

    const [
      hoje,
      semana,
      cred,
      contasPagar,
      comprasMes,
      vendasMes,
      cmvRows,
      despRows,
      chartRows,
      estoqueValor,
      linhasDoMes,
      estoqueParadoRows,
      despOperacional,
      higLotes,
    ] = await Promise.all([
      db.sale.aggregate({
        _sum: { totalAmount: true },
        // Canceladas fora: a venda desfeita não é faturamento.
        where: { saleDate: { gte: todayStart, lte: ateAgora }, cancelledAt: null },
      }),
      db.sale.aggregate({
        _sum: { totalAmount: true },
        where: { saleDate: { gte: weekStart, lte: ateAgora }, cancelledAt: null },
      }),
      db.creditAccount.aggregate({
        _sum: { totalAmount: true, paidAmount: true },
        where: { status: "EM_ABERTO" },
      }),
      // Sem janela, o card "Contas do mês — A pagar" somava TODO pendente de
      // qualquer mês: a conta atrasada de julho e a parcela de outubro já
      // gerada. O rótulo dizia mês e a consulta dizia histórico, então
      // "Contas fixas" + "Contas variáveis" não fechavam com o card acima
      // deles e /despesas mostrava um terceiro número. Mesma janela de
      // `resumoMes.aPagar`: um número por conceito.
      db.expense.aggregate({
        _sum: { amount: true },
        where: { status: "PENDENTE", dueDate: { gte: monthStart, lte: fimDoMes } },
      }),
      db.purchase.aggregate({
        _sum: { totalAmount: true },
        where: { purchaseDate: { gte: monthStart, lte: ateAgora } },
      }),
      db.sale.aggregate({
        _sum: { totalAmount: true },
        where: { saleDate: { gte: monthStart, lte: ateAgora }, cancelledAt: null },
      }),
      prisma.$queryRaw<{ cmv: Prisma.Decimal | string }[]>`
        SELECT COALESCE(SUM(si.quantity * si."unitCostAtSale"), 0) AS cmv
        FROM sale_items si
        JOIN sales s ON s.id = si."saleId"
        WHERE si."tenantId" = ${tenantId} AND s."saleDate" >= ${monthStart} AND s."saleDate" <= ${ateAgora} AND s."deletedAt" IS NULL AND s."cancelledAt" IS NULL
      `,
      prisma.$queryRaw<{ type: string; total: Prisma.Decimal | string }[]>`
        SELECT type::text AS type, COALESCE(SUM(amount), 0) AS total
        FROM expenses
        WHERE "tenantId" = ${tenantId} AND "deletedAt" IS NULL
          AND COALESCE("dueDate", "createdAt") >= ${monthStart}
          AND COALESCE("dueDate", "createdAt") <= ${fimDoMes}
        GROUP BY type
      `,
      // A coluna é `timestamp` sem fuso, guardando UTC. Truncar direto agrupava
      // por dia UTC: a venda das 22h ia para a barra do dia seguinte. Reinterpreta
      // como UTC, converte para o fuso do app e só então trunca — o resultado é
      // uma data civil brasileira, que `isoDateTz` lê de volta sem deslocar.
      prisma.$queryRaw<{ d: Date; total: Prisma.Decimal | string }[]>`
        SELECT DATE_TRUNC('day', "saleDate" AT TIME ZONE 'UTC' AT TIME ZONE ${APP_TIME_ZONE}) AS d,
               SUM("totalAmount") AS total
        FROM sales
        WHERE "tenantId" = ${tenantId} AND "deletedAt" IS NULL AND "cancelledAt" IS NULL AND "saleDate" >= ${chartStart} AND "saleDate" <= ${ateAgora}
        GROUP BY d ORDER BY d ASC
      `,
      EstoqueService.getTotalValue(tenantId),
      // Receita por produto com o desconto da VENDA rateado — a mesma fonte dos
      // relatórios. Somando `lineTotal` cru, "Mais lucrativos" mostrava lucro
      // numa venda que deu prejuízo depois do desconto, e "Com prejuízo" não a
      // apontava. Teto "até agora", como os cartões do mês: sem ele a venda com
      // data futura entrava nas listas e não nos cartões do mesmo painel.
      linhasVendidas(tenantId, monthStart, ateAgora),
      prisma.$queryRaw<IdleProductRow[]>`
        WITH saldo AS (
          SELECT "productId",
                 COALESCE(SUM(CASE WHEN type IN ('ENTRADA','AJUSTE') THEN quantity ELSE -quantity END), 0) AS quantity,
                 MAX("movedAt") AS "lastMovementAt"
          FROM stock_movements
          WHERE "tenantId" = ${tenantId}
          GROUP BY "productId"
        )
        SELECT p.id AS "productId",
               p.name AS name,
               saldo.quantity AS quantity,
               saldo."lastMovementAt" AS "lastMovementAt"
        FROM saldo
        JOIN products p ON p.id = saldo."productId"
        WHERE p."tenantId" = ${tenantId}
          AND p."deletedAt" IS NULL
          AND saldo.quantity > 0
          AND NOT EXISTS (
            SELECT 1
            FROM sale_items si
            JOIN sales s ON s.id = si."saleId"
            WHERE si."tenantId" = ${tenantId}
              AND si."productId" = p.id
              AND s."deletedAt" IS NULL AND s."cancelledAt" IS NULL
              AND s."saleDate" >= ${idleCutoff}
          )
        ORDER BY saldo."lastMovementAt" ASC NULLS FIRST, p.name ASC
        LIMIT 5
      `,
      prisma.$queryRaw<{ total: Prisma.Decimal | string }[]>`
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM expenses
        WHERE "tenantId" = ${tenantId} AND "deletedAt" IS NULL
          AND "purchaseId" IS NULL
          AND COALESCE("dueDate", "createdAt") >= ${monthStart}
          AND COALESCE("dueDate", "createdAt") <= ${fimDoMes}
      `,
      isModuleEnabled(modules, "higienizacao")
        ? higienizacaoDoMes(tenantId, monthStart, fimDoMes)
        : Promise.resolve(HIGIENIZACAO_ZERADA),
    ]);

    const porProduto = porProdutoDoMes(linhasDoMes);
    const vendasMesTotal = toDecimal(vendasMes._sum.totalAmount ?? 0);
    const cmvMes = toDecimal((cmvRows[0]?.cmv ?? 0) as Prisma.Decimal.Value);
    const despesasFixasMes = sumExpenseByType(despRows, "FIXA");
    let despesasVariaveisMes = sumExpenseByType(despRows, "VARIAVEL");

    const {
      saldoAberto: higSaldoAberto,
      pagaNoPeriodo: higPagaMes,
      enviadaNoPeriodo: higEnviadaMes,
    } = higLotes;
    despesasVariaveisMes = money(despesasVariaveisMes.plus(higEnviadaMes));

    // Frete lançado como despesa já está no CMV (unitCost). Higienização paga
    // no mês é opex de verdade e entra no lucro líquido.
    const despesasLucro = money(
      toDecimal((despOperacional[0]?.total ?? 0) as Prisma.Decimal.Value).plus(higPagaMes),
    );
    const lucroBrutoMes = FinancialCalc.lucroBruto(vendasMesTotal, cmvMes);
    const lucroMes = FinancialCalc.lucroLiquido(lucroBrutoMes, despesasLucro);

    const aReceber = FinancialCalc.saldoFiado(
      cred._sum.totalAmount ?? 0,
      cred._sum.paidAmount ?? 0,
    );

    const byDay = new Map<string, number>();
    for (const r of chartRows) {
      // `d` já é a data civil brasileira (o SQL converteu). Prisma a devolve como
      // instante UTC, então os campos UTC são exatamente o dia que queremos.
      byDay.set(
        new Date(r.d).toISOString().slice(0, 10),
        toDecimal(r.total as Prisma.Decimal.Value).toNumber(),
      );
    }
    const chart: { date: string; total: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const day = isoDateTz(addDays(now, -i));
      chart.push({ date: day, total: byDay.get(day) ?? 0 });
    }

    return {
      hojeVendi: money(toDecimal(hoje._sum.totalAmount ?? 0)),
      semanaVendi: money(toDecimal(semana._sum.totalAmount ?? 0)),
      mesVendi: money(vendasMesTotal),
      totalCompradoMes: money(toDecimal(comprasMes._sum.totalAmount ?? 0)),
      aReceber,
      contasPagar: money(toDecimal(contasPagar._sum.amount ?? 0).plus(higSaldoAberto)),
      estoqueValor,
      lucroBrutoMes,
      lucroMes,
      margemLiquidaMes: FinancialCalc.margemLiquida(lucroMes, vendasMesTotal),
      despesasFixasMes,
      despesasVariaveisMes,
      topVendidos: [...porProduto]
        .sort((a, b) => b.quantity.comparedTo(a.quantity) || b.total.comparedTo(a.total))
        .slice(0, 5),
      topLucrativos: [...porProduto]
        .sort((a, b) => b.profit.comparedTo(a.profit) || b.total.comparedTo(a.total))
        .slice(0, 5),
      produtosComPrejuizo: porProduto
        .filter((r) => r.profit.isNegative())
        .sort((a, b) => a.profit.comparedTo(b.profit))
        .slice(0, 5),
      estoqueParado: estoqueParadoRows.map((r) => ({
        productId: r.productId,
        name: r.name,
        quantity: toDecimal(r.quantity as Prisma.Decimal.Value),
        lastMovementAt: r.lastMovementAt,
      })),
      chart,
    };
  },
};

interface IdleProductRow {
  productId: string;
  name: string;
  quantity: Prisma.Decimal | string;
  lastMovementAt: Date | null;
}

function porProdutoDoMes(linhas: LinhaVendida[]): DashboardProductRow[] {
  return resumirPor(linhas, (l) => l.productId).map((r) => ({
    productId: r.productId,
    name: r.name,
    quantity: r.qtd,
    total: r.receita,
    profit: r.lucro,
  }));
}

function sumExpenseByType(
  rows: { type: string; total: Prisma.Decimal | string }[],
  type: "FIXA" | "VARIAVEL",
) {
  return money(
    toDecimal((rows.find((r) => r.type === type)?.total ?? 0) as Prisma.Decimal.Value),
  );
}
