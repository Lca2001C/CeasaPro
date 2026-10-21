import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { money, toDecimal } from "@/lib/money";
import { endOfDay } from "@/lib/dates";
import { APP_TIME_ZONE, addDaysTz, refMonthTz, startOfMonthTz, startOfNextMonthTz } from "@/lib/tz";
import { isModuleEnabled } from "@/lib/plan/modules";

/**
 * Números da aba "Financeiro" do Início que o resumo do mês
 * (`DashboardService.getSummary`) não traz: a série dos últimos meses, como o
 * dinheiro das vendas entrou e para onde foram as contas.
 *
 * As mesmas janelas e os mesmos filtros do resumo, para os gráficos fecharem
 * com os cartões ao lado deles:
 * - venda e compra até AGORA (data futura não é faturamento realizado);
 * - conta pelo `COALESCE("dueDate","createdAt")` até o FIM do mês, e só a
 *   operacional (`origem = 'MANUAL'`) — a conta de uma compra já está no custo
 *   da mercadoria, e aqui ela seria mercadoria contada duas vezes.
 *
 * - "Vendas" é o FATURAMENTO (mercadoria + embalagem vendida, com o módulo) e
 *   "Contas" inclui a higienização pela data de ENVIO (com o módulo) — os
 *   mesmos componentes do "Resultado do mês", para a coluna do mês atual
 *   fechar com ele.
 *
 * Os meses são agrupados no fuso do app: as colunas são `timestamp` sem fuso
 * guardando UTC, e truncar direto jogaria a venda das 22h do último dia do mês
 * no mês seguinte.
 */

export interface MesFinanceiro {
  /** "YYYY-MM". */
  mes: string;
  vendas: number;
  compras: number;
  contas: number;
}

export interface FatiaValor {
  chave: string;
  total: number;
}

export interface PainelFinanceiro {
  meses: MesFinanceiro[];
  formasDePagamento: FatiaValor[];
  contasPorCategoria: FatiaValor[];
}

/** Quantos meses o gráfico de evolução mostra (o atual incluído). */
export const MESES_NO_GRAFICO = 6;
/** Categorias com nome no gráfico de contas; o resto vira "Outras". */
const CATEGORIAS_NO_GRAFICO = 5;

const mesDe = (coluna: string) =>
  Prisma.raw(
    `to_char(DATE_TRUNC('month', ${coluna} AT TIME ZONE 'UTC' AT TIME ZONE '${APP_TIME_ZONE}'), 'YYYY-MM')`,
  );

const numero = (v: Prisma.Decimal | string | number | null | undefined) =>
  Number(money(toDecimal((v ?? 0) as Prisma.Decimal.Value)));

export const PainelFinanceiroService = {
  async get(
    tenantId: string,
    agora = new Date(),
    modules?: string[],
  ): Promise<PainelFinanceiro> {
    const comHigienizacao = isModuleEnabled(modules, "higienizacao");
    const comEmbalagens = isModuleEnabled(modules, "embalagens");
    const inicioDoMes = startOfMonthTz(agora);
    let inicioDaSerie = inicioDoMes;
    for (let i = 1; i < MESES_NO_GRAFICO; i++) {
      inicioDaSerie = startOfMonthTz(addDaysTz(inicioDaSerie, -1));
    }
    const ateAgora = endOfDay(agora);
    const fimDoMes = new Date(startOfNextMonthTz(agora).getTime() - 1);

    type Linha = { mes: string; total: Prisma.Decimal | string };
    type Grupo = { chave: string | null; total: Prisma.Decimal | string };

    const nada = Promise.resolve([] as Linha[]);
    const [vendas, compras, contas, formas, categorias, embalagens, higienizacao] = await Promise.all([
      prisma.$queryRaw<Linha[]>`
        SELECT ${mesDe('"saleDate"')} AS mes, SUM("totalAmount") AS total
        FROM sales
        WHERE "tenantId" = ${tenantId} AND "deletedAt" IS NULL AND "cancelledAt" IS NULL
          AND "saleDate" >= ${inicioDaSerie} AND "saleDate" <= ${ateAgora}
        GROUP BY 1`,
      prisma.$queryRaw<Linha[]>`
        SELECT ${mesDe('"purchaseDate"')} AS mes, SUM("totalAmount") AS total
        FROM purchases
        WHERE "tenantId" = ${tenantId} AND "deletedAt" IS NULL AND "cancelledAt" IS NULL
          AND "purchaseDate" >= ${inicioDaSerie} AND "purchaseDate" <= ${ateAgora}
        GROUP BY 1`,
      prisma.$queryRaw<Linha[]>`
        SELECT ${mesDe('COALESCE("dueDate", "createdAt")')} AS mes, SUM(amount) AS total
        FROM expenses
        WHERE "tenantId" = ${tenantId} AND "deletedAt" IS NULL AND origem = 'MANUAL'
          AND COALESCE("dueDate", "createdAt") >= ${inicioDaSerie}
          AND COALESCE("dueDate", "createdAt") <= ${fimDoMes}
        GROUP BY 1`,
      // Como o dinheiro das vendas do mês entrou. Venda com pagamento misto
      // ("metade PIX, metade fiado") vale pelas parcelas; a venda antiga, sem
      // parcela registrada, pelo total e a forma dela — a mesma regra do fluxo
      // de caixa.
      prisma.$queryRaw<Grupo[]>`
        SELECT chave, SUM(total) AS total FROM (
          SELECT s."paymentMethod"::text AS chave, s."totalAmount" AS total
          FROM sales s
          WHERE s."tenantId" = ${tenantId} AND s."deletedAt" IS NULL AND s."cancelledAt" IS NULL
            AND s."saleDate" >= ${inicioDoMes} AND s."saleDate" <= ${ateAgora}
            AND NOT EXISTS (SELECT 1 FROM sale_payments sp WHERE sp."saleId" = s.id)
          UNION ALL
          SELECT sp.method::text AS chave, sp.amount AS total
          FROM sale_payments sp
          JOIN sales s ON s.id = sp."saleId"
          WHERE s."tenantId" = ${tenantId} AND s."deletedAt" IS NULL AND s."cancelledAt" IS NULL
            AND s."saleDate" >= ${inicioDoMes} AND s."saleDate" <= ${ateAgora}
        ) entradas
        GROUP BY chave`,
      prisma.$queryRaw<Grupo[]>`
        SELECT c.name AS chave, SUM(e.amount) AS total
        FROM expenses e
        LEFT JOIN expense_categories c ON c.id = e."categoryId"
        WHERE e."tenantId" = ${tenantId} AND e."deletedAt" IS NULL AND e.origem = 'MANUAL'
          AND COALESCE(e."dueDate", e."createdAt") >= ${inicioDoMes}
          AND COALESCE(e."dueDate", e."createdAt") <= ${fimDoMes}
        GROUP BY c.name`,
      comEmbalagens
        ? prisma.$queryRaw<Linha[]>`
            SELECT ${mesDe('"saleDate"')} AS mes, SUM("totalAmount") AS total
            FROM packaging_sales
            WHERE "tenantId" = ${tenantId} AND "deletedAt" IS NULL AND "cancelledAt" IS NULL
              AND "saleDate" >= ${inicioDaSerie} AND "saleDate" <= ${ateAgora}
            GROUP BY 1`
        : nada,
      comHigienizacao
        ? prisma.$queryRaw<Linha[]>`
            SELECT ${mesDe('"sentDate"')} AS mes, SUM("totalAmount") AS total
            FROM crate_cleanings
            WHERE "tenantId" = ${tenantId} AND "deletedAt" IS NULL
              AND "sentDate" >= ${inicioDaSerie} AND "sentDate" <= ${fimDoMes}
            GROUP BY 1`
        : nada,
    ]);

    const porMes = (linhas: Linha[]) => new Map(linhas.map((l) => [l.mes, numero(l.total)]));
    const v = porMes(vendas);
    const c = porMes(compras);
    const d = porMes(contas);
    const e = porMes(embalagens);
    const h = porMes(higienizacao);
    const meses: MesFinanceiro[] = [];
    for (let i = 0, ref = inicioDaSerie; i < MESES_NO_GRAFICO; i++) {
      const mes = refMonthTz(ref);
      meses.push({
        mes,
        vendas: Number(money(toDecimal(v.get(mes) ?? 0).plus(e.get(mes) ?? 0))),
        compras: c.get(mes) ?? 0,
        contas: Number(money(toDecimal(d.get(mes) ?? 0).plus(h.get(mes) ?? 0))),
      });
      ref = startOfNextMonthTz(ref);
    }

    const ordenar = (g: Grupo[]) =>
      g
        .map((x) => ({ chave: x.chave ?? "Sem categoria", total: numero(x.total) }))
        .filter((x) => x.total > 0)
        .sort((a, b) => b.total - a.total);

    // As mesmas partes do "Resultado do mês": a higienização enviada é conta do
    // mês (a barra "Contas" já a soma) e a embalagem vendida é dinheiro que
    // entrou. Fora daqui, as fatias somavam menos que a coluna ao lado.
    const mesAtual = refMonthTz(agora);
    const higMes = h.get(mesAtual) ?? 0;
    const embMes = e.get(mesAtual) ?? 0;
    const todasCategorias = ordenar([
      ...categorias,
      ...(higMes > 0 ? [{ chave: "Higienização", total: String(higMes) }] : []),
    ]);
    const contasPorCategoria = todasCategorias.slice(0, CATEGORIAS_NO_GRAFICO);
    const resto = todasCategorias.slice(CATEGORIAS_NO_GRAFICO);
    if (resto.length > 0) {
      contasPorCategoria.push({
        chave: "Outras",
        total: Number(money(resto.reduce((a, x) => a.plus(x.total), toDecimal(0)))),
      });
    }

    return {
      meses,
      formasDePagamento: ordenar([
        ...formas,
        ...(embMes > 0 ? [{ chave: "EMBALAGEM", total: String(embMes) }] : []),
      ]),
      contasPorCategoria,
    };
  },
};
