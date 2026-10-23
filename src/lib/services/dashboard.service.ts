import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { toDecimal, money } from "@/lib/money";
import { FinancialCalc } from "./financial-calc.service";
import { EstoqueService } from "./estoque.service";
import { startOfDay, startOfMonth, addDays, endOfDay } from "@/lib/dates";
import { APP_TIME_ZONE, isoDateTz, startOfNextMonthTz } from "@/lib/tz";
import { isModuleEnabled } from "@/lib/plan/modules";
import { chaveDeModulos, lembrar, versao } from "@/lib/cache/cache";
import { ORIGEM_BAIXA_EMBALAGEM, ORIGEM_BAIXA_EMBALAGEM_DESFEITA } from "@/lib/estoque/origens";
import { linhasVendidas, resumirPor, type LinhaVendida } from "@/lib/reports/linhas-vendidas";
import { HIGIENIZACAO_ZERADA, resumoDaHigienizacao } from "./despesas.service";
import {
  ORIGEM_AJUSTE,
  ORIGEM_AJUSTE_DESFEITO,
  ORIGEM_PRODUTO_EXCLUIDO,
} from "@/lib/estoque/origens";

/**
 * Higienização do mês para o painel: saldo em aberto e o custo dos lotes
 * ENVIADOS no mês — que é o que entra em "Contas variáveis" E no lucro.
 *
 * Tudo somado no banco. Antes o painel carregava todos os lotes da história e
 * somava o `paidAmount` ACUMULADO pela data do ÚLTIMO pagamento.
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
  /** Custo da mercadoria vendida no mês (CMV) — o que o lucro bruto desconta. */
  cmvMes: Prisma.Decimal;
  /**
   * Venda avulsa de embalagem (papelão, sacaria…) no mês. Não é "Vendi" — não
   * passa pelo PDV —, mas é receita: soma no lucro bruto, e o "Resultado do
   * mês" a mostra numa linha.
   */
  embalagensMes: Prisma.Decimal;
  /** Custo médio das embalagens vendidas no mês (o "CMV" delas). */
  custoEmbalagensMes: Prisma.Decimal;
  /** Vendas de embalagem do mês sem custo conhecido (tipo sem controle de estoque). */
  embalagensSemCusto: number;
  /**
   * Perdas e acertos de estoque do mês, pelo custo do movimento: quebra,
   * doação e acerto para baixo menos o acerto para cima. Ajuste desfeito fica
   * de fora (o par se anula).
   */
  perdasEstoqueMes: Prisma.Decimal;
  /** Fiado baixado como perda no mês (pela data da BAIXA). */
  perdasFiadoMes: Prisma.Decimal;
  /** Recebido no mês de fiado JÁ baixado como perda (recuperação). */
  recuperadoFiadoMes: Prisma.Decimal;
  /**
   * Contas que o lucro líquido desconta: as operacionais do mês e a
   * higienização ENVIADA no mês. É exatamente "Contas fixas" + "Contas
   * variáveis" — os cartões e o lucro usam a mesma data.
   */
  despesasLucroMes: Prisma.Decimal;
  lucroMes: Prisma.Decimal;
  margemLiquidaMes: Prisma.Decimal;
  despesasFixasMes: Prisma.Decimal;
  despesasVariaveisMes: Prisma.Decimal;
  /**
   * Higienização ENVIADA no mês — a parte de "Contas variáveis" (e de
   * `despesasLucroMes`) que não é despesa lançada. Só para explicar a conta.
   */
  higienizacaoMes: Prisma.Decimal;
  topVendidos: DashboardProductRow[];
  topLucrativos: DashboardProductRow[];
  produtosComPrejuizo: DashboardProductRow[];
  estoqueParado: DashboardIdleProduct[];
  chart: { date: string; total: number }[];
}

export const DashboardService = {
  /**
   * @param parte Só o que a aba do Início mostra. Cada aba usa metade dos
   *   números, e calcular as duas sempre dobrava as consultas da carga (o
   *   Início é a tela que todo mundo abre). Sem `parte`, calcula tudo — é o que
   *   o snapshot offline precisa. Os campos da parte não pedida vêm zerados.
   *   `"resumo"` são só os números do snapshot offline (hoje e a receber — o
   *   valor do estoque ele tira das posições, e o a pagar de `ContasPagarService`).
   */
  async getSummary(
    tenantId: string,
    modules?: string[],
    parte?: "geral" | "financeiro" | "resumo",
  ): Promise<DashboardSummary> {
    // O dia entra na chave: na virada da meia-noite o "hoje" muda sem escrita.
    return lembrar(
      {
        chave: `dash:${tenantId}:${parte ?? "tudo"}:${isoDateTz()}:${chaveDeModulos(modules)}`,
        versoes: [versao.tenant(tenantId)],
        ttlSeg: 60,
      },
      () => this.calcularSummary(tenantId, modules, parte),
    );
  },

  /** `getSummary` sem cache — o cálculo de fato. */
  async calcularSummary(
    tenantId: string,
    modules?: string[],
    parte?: "geral" | "financeiro" | "resumo",
  ): Promise<DashboardSummary> {
    const geral = parte === undefined || parte === "geral";
    const fin = parte === undefined || parte === "financeiro";
    const contas = fin;
    // As DUAS abas mostram "Sobrou no mês": a Visão Geral também precisa de
    // tudo o que entra no lucro. Pular isso nela fazia o cartão mostrar o
    // próprio "Vendi" como lucro.
    const lucro = geral || fin;
    const comHigienizacao = isModuleEnabled(modules, "higienizacao");
    const comEmbalagens = isModuleEnabled(modules, "embalagens");
    /** Valor neutro com o MESMO formato do resultado da consulta pulada. */
    const pula = <T,>(v: T) => Promise.resolve(v);
    const somaVazia = { _sum: { totalAmount: null, amount: null, paidAmount: null } } as const;
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
      embalagensRows,
      baixasEmbalagemRows,
      perdasRows,
      perdaEstoqueRows,
      recuperadoRows,
    ] = await Promise.all([
      db.sale.aggregate({
        _sum: { totalAmount: true },
        // Canceladas fora: a venda desfeita não é faturamento.
        where: { saleDate: { gte: todayStart, lte: ateAgora }, cancelledAt: null },
      }),
      fin
        ? db.sale.aggregate({
            _sum: { totalAmount: true },
            where: { saleDate: { gte: weekStart, lte: ateAgora }, cancelledAt: null },
          })
        : pula(somaVazia),
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
      contas
        ? db.expense.aggregate({
            _sum: { amount: true },
            where: { status: "PENDENTE", dueDate: { gte: monthStart, lte: fimDoMes } },
          })
        : pula(somaVazia),
      fin
        ? db.purchase.aggregate({
            _sum: { totalAmount: true },
            where: { purchaseDate: { gte: monthStart, lte: ateAgora }, cancelledAt: null },
          })
        : pula(somaVazia),
      db.sale.aggregate({
        _sum: { totalAmount: true },
        where: { saleDate: { gte: monthStart, lte: ateAgora }, cancelledAt: null },
      }),
      !lucro ? pula([] as { cmv: Prisma.Decimal | string }[]) : prisma.$queryRaw<{ cmv: Prisma.Decimal | string }[]>`
        SELECT COALESCE(SUM(si.quantity * si."unitCostAtSale"), 0) AS cmv
        FROM sale_items si
        JOIN sales s ON s.id = si."saleId"
        WHERE si."tenantId" = ${tenantId} AND s."saleDate" >= ${monthStart} AND s."saleDate" <= ${ateAgora} AND s."deletedAt" IS NULL AND s."cancelledAt" IS NULL
      `,
      !fin ? pula([] as { type: string; total: Prisma.Decimal | string }[]) : prisma.$queryRaw<{ type: string; total: Prisma.Decimal | string }[]>`
        SELECT type::text AS type, COALESCE(SUM(amount), 0) AS total
        FROM expenses
        WHERE "tenantId" = ${tenantId} AND "deletedAt" IS NULL
          -- Só despesa operacional: a conta da compra já está no CMV e, aqui,
          -- inflaria "Contas variáveis" com a mercadoria do mês.
          AND origem = 'MANUAL'
          AND COALESCE("dueDate", "createdAt") >= ${monthStart}
          AND COALESCE("dueDate", "createdAt") <= ${fimDoMes}
        GROUP BY type
      `,
      // A coluna é `timestamp` sem fuso, guardando UTC. Truncar direto agrupava
      // por dia UTC: a venda das 22h ia para a barra do dia seguinte. Reinterpreta
      // como UTC, converte para o fuso do app e só então trunca — o resultado é
      // uma data civil brasileira, que `isoDateTz` lê de volta sem deslocar.
      !fin ? pula([] as { d: Date; total: Prisma.Decimal | string }[]) : prisma.$queryRaw<{ d: Date; total: Prisma.Decimal | string }[]>`
        SELECT DATE_TRUNC('day', "saleDate" AT TIME ZONE 'UTC' AT TIME ZONE ${APP_TIME_ZONE}) AS d,
               SUM("totalAmount") AS total
        FROM sales
        WHERE "tenantId" = ${tenantId} AND "deletedAt" IS NULL AND "cancelledAt" IS NULL AND "saleDate" >= ${chartStart} AND "saleDate" <= ${ateAgora}
        GROUP BY d ORDER BY d ASC
      `,
      geral ? EstoqueService.getTotalValue(tenantId) : pula(toDecimal(0)),
      // Receita por produto com o desconto da VENDA rateado — a mesma fonte dos
      // relatórios. Somando `lineTotal` cru, "Mais lucrativos" mostrava lucro
      // numa venda que deu prejuízo depois do desconto, e "Com prejuízo" não a
      // apontava. Teto "até agora", como os cartões do mês: sem ele a venda com
      // data futura entrava nas listas e não nos cartões do mesmo painel.
      geral ? linhasVendidas(tenantId, monthStart, ateAgora) : pula([] as Awaited<ReturnType<typeof linhasVendidas>>),
      !geral ? pula([] as IdleProductRow[]) : prisma.$queryRaw<IdleProductRow[]>`
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
      !lucro ? pula([] as { total: Prisma.Decimal | string }[]) : prisma.$queryRaw<{ total: Prisma.Decimal | string }[]>`
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM expenses
        WHERE "tenantId" = ${tenantId} AND "deletedAt" IS NULL
          AND origem = 'MANUAL'
          AND COALESCE("dueDate", "createdAt") >= ${monthStart}
          AND COALESCE("dueDate", "createdAt") <= ${fimDoMes}
      `,
      (contas || lucro) && comHigienizacao
        ? higienizacaoDoMes(tenantId, monthStart, fimDoMes)
        : Promise.resolve(HIGIENIZACAO_ZERADA),
      // Receita E custo da embalagem vendida. O custo é o médio gravado na
      // venda (`unitCostAtSale`); sem ele (tipo sem controle de estoque), a
      // venda conta como receita sem custo — e a tela avisa quantas são.
      !(lucro && comEmbalagens)
        ? pula([] as LinhaEmbalagens[])
        : prisma.$queryRaw<LinhaEmbalagens[]>`
            SELECT COALESCE(SUM("totalAmount"), 0) AS total,
                   -- Arredondado POR VENDA, como FinancialCalc.custoVendaEmbalagem.
                   COALESCE(SUM(ROUND(quantity * "unitCostAtSale", 2)), 0) AS custo,
                   COUNT(*) FILTER (WHERE "unitCostAtSale" IS NULL)::int AS sem_custo
            FROM packaging_sales
            WHERE "tenantId" = ${tenantId} AND "deletedAt" IS NULL AND "cancelledAt" IS NULL
              AND "saleDate" >= ${monthStart} AND "saleDate" <= ${ateAgora}
          `,
      // Embalagem baixada sem ser vendida (quebra, uso), pelo custo médio.
      !(lucro && comEmbalagens)
        ? pula([] as { total: Prisma.Decimal | string }[])
        : prisma.$queryRaw<{ total: Prisma.Decimal | string }[]>`
            SELECT COALESCE(SUM(ROUND(b.quantity * COALESCE(b."unitCost", 0), 2)), 0) AS total
            FROM packaging_movements b
            WHERE b."tenantId" = ${tenantId} AND b."sourceType" = ${ORIGEM_BAIXA_EMBALAGEM}
              AND b."movedAt" >= ${monthStart} AND b."movedAt" <= ${ateAgora}
              -- Baixa desfeita (até 24 h) não é custo.
              AND NOT EXISTS (
                SELECT 1 FROM packaging_movements d
                WHERE d."tenantId" = ${tenantId} AND d."sourceType" = ${ORIGEM_BAIXA_EMBALAGEM_DESFEITA}
                  AND d."sourceId" = b.id
              )
          `,
      // Fiado baixado como perda NESTE mês (data da baixa, não da venda). Pela
      // marca da baixa e não pelo status: a conta recuperada por inteiro depois
      // vira PAGO, e a perda daquele mês continua tendo acontecido.
      !lucro
        ? pula([] as { total: Prisma.Decimal | string }[])
        : prisma.$queryRaw<{ total: Prisma.Decimal | string }[]>`
            SELECT COALESCE(SUM("writtenOffAmount"), 0) AS total
            FROM credit_accounts
            WHERE "tenantId" = ${tenantId} AND "deletedAt" IS NULL
              AND "writtenOffAt" IS NOT NULL
              -- Conta antiga SEM venda (de antes de o fiado manual gerar venda):
              -- o valor nunca entrou no faturamento, então a perda também não
              -- sai do lucro. A baixa continua tirando do "a receber".
              AND "saleId" IS NOT NULL
              AND "writtenOffAt" >= ${monthStart} AND "writtenOffAt" <= ${ateAgora}
          `,
      // Perdas e acertos de estoque do mês (ver `perdasEstoqueMes`).
      !lucro
        ? pula([] as { total: Prisma.Decimal | string }[])
        : prisma.$queryRaw<{ total: Prisma.Decimal | string }[]>`
            SELECT COALESCE(SUM(ROUND(
                     CASE WHEN m.type IN ('QUEBRA', 'DOACAO') THEN m.quantity
                          WHEN m.type = 'AJUSTE' THEN -m.quantity
                          ELSE 0 END * COALESCE(m."unitCost", 0), 2)), 0) AS total
            FROM stock_movements m
            WHERE m."tenantId" = ${tenantId}
              AND (m."sourceType" IN (${ORIGEM_AJUSTE}, ${ORIGEM_PRODUTO_EXCLUIDO})
                   OR (m."sourceType" IS NULL AND m.type IN ('QUEBRA', 'DOACAO')))
              AND m."movedAt" >= ${monthStart} AND m."movedAt" <= ${ateAgora}
              AND NOT EXISTS (
                SELECT 1 FROM stock_movements e
                WHERE e."tenantId" = m."tenantId"
                  AND e."sourceType" = ${ORIGEM_AJUSTE_DESFEITO}
                  AND e."sourceId" = m.id
              )
          `,
      // Recebido NESTE mês de fiado já baixado: volta ao resultado.
      !lucro
        ? pula([] as { total: Prisma.Decimal | string }[])
        : prisma.$queryRaw<{ total: Prisma.Decimal | string }[]>`
            SELECT COALESCE(SUM(pg.amount), 0) AS total
            FROM credit_payments pg
            JOIN credit_accounts a ON a.id = pg."accountId"
            WHERE pg."tenantId" = ${tenantId} AND a."tenantId" = ${tenantId}
              AND pg."aposBaixa" AND pg."reversedAt" IS NULL
              -- Pela mesma razão da perda: conta sem venda fica fora do lucro.
              AND a."saleId" IS NOT NULL
              AND pg."paidAt" >= ${monthStart} AND pg."paidAt" <= ${ateAgora}
          `,
    ]);

    const porProduto = porProdutoDoMes(linhasDoMes);
    const vendasMesTotal = toDecimal(vendasMes._sum.totalAmount ?? 0);
    const cmvMes = toDecimal((cmvRows[0]?.cmv ?? 0) as Prisma.Decimal.Value);
    const despesasFixasMes = sumExpenseByType(despRows, "FIXA");
    let despesasVariaveisMes = sumExpenseByType(despRows, "VARIAVEL");

    const { saldoAberto: higSaldoAberto, enviadaNoPeriodo: higEnviadaMes } = higLotes;
    despesasVariaveisMes = money(despesasVariaveisMes.plus(higEnviadaMes));

    // A conta da compra (mercadoria + frete) já está no CMV (unitCost) e fica
    // fora pelo `origem = 'MANUAL'` da consulta.
    //
    // A higienização entra pelo ENVIO, como em "Contas variáveis" — e como a
    // conta operacional, que entra pelo vencimento, não pelo pagamento. Entrava
    // pelo PAGAMENTO: o lote enviado em outubro e pago em novembro aparecia em
    // variáveis de outubro sem descontar no lucro de outubro, e descontava em
    // novembro sem aparecer em variáveis — "Ganhei − fixas − variáveis" não
    // fechava com "Sobrou" em nenhum dos dois meses. O que saiu do caixa no mês
    // continua em "Contas pagas" e no fluxo de caixa.
    const despesasLucro = money(
      toDecimal((despOperacional[0]?.total ?? 0) as Prisma.Decimal.Value).plus(higEnviadaMes),
    );
    const linhaEmb = embalagensRows[0];
    const embalagens = money(toDecimal((linhaEmb?.total ?? 0) as Prisma.Decimal.Value));
    // Custo das embalagens = as vendidas (custo gravado na venda) + as baixadas
    // sem venda (quebra, uso).
    const custoEmbalagens = money(
      toDecimal((linhaEmb?.custo ?? 0) as Prisma.Decimal.Value).plus(
        toDecimal((baixasEmbalagemRows[0]?.total ?? 0) as Prisma.Decimal.Value),
      ),
    );
    const perdasFiado = money(toDecimal((perdasRows[0]?.total ?? 0) as Prisma.Decimal.Value));
    const recuperadoFiado = money(
      toDecimal((recuperadoRows[0]?.total ?? 0) as Prisma.Decimal.Value),
    );
    const faturamentoMes = FinancialCalc.faturamento(vendasMesTotal, embalagens);
    const perdasEstoque = money(
      toDecimal((perdaEstoqueRows[0]?.total ?? 0) as Prisma.Decimal.Value),
    );
    const lucroBrutoMes = FinancialCalc.lucroBruto(
      faturamentoMes,
      FinancialCalc.custoDoVendido(cmvMes, custoEmbalagens, perdasEstoque),
    );
    const lucroMes = FinancialCalc.lucroLiquido(
      lucroBrutoMes,
      despesasLucro,
      perdasFiado,
      recuperadoFiado,
    );

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
      contasPagar: money(
        toDecimal(contasPagar._sum.amount ?? 0).plus(contas ? higSaldoAberto : 0),
      ),
      estoqueValor,
      lucroBrutoMes,
      cmvMes: money(cmvMes),
      embalagensMes: embalagens,
      custoEmbalagensMes: custoEmbalagens,
      embalagensSemCusto: Number(linhaEmb?.sem_custo ?? 0),
      perdasEstoqueMes: perdasEstoque,
      perdasFiadoMes: perdasFiado,
      recuperadoFiadoMes: recuperadoFiado,
      despesasLucroMes: despesasLucro,
      lucroMes,
      margemLiquidaMes: FinancialCalc.margemLiquida(lucroMes, faturamentoMes),
      despesasFixasMes,
      despesasVariaveisMes,
      higienizacaoMes: money(higEnviadaMes),
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

interface LinhaEmbalagens {
  total: Prisma.Decimal | string;
  custo: Prisma.Decimal | string;
  sem_custo: number;
}

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
