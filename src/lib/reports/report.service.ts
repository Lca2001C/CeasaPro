import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { EstoqueService } from "@/lib/services/estoque.service";
import { CaixasService } from "@/lib/services/caixas.service";
import { perdasPorLote } from "@/lib/services/higienizacao.service";
import { FinancialCalc } from "@/lib/services/financial-calc.service";
import { add, sub, toDecimal, money } from "@/lib/money";
import { formatQty } from "@/lib/format";
import { addDaysTz, APP_TIME_ZONE, startOfDayTz } from "@/lib/tz";
import {
  PAYMENT_METHOD_LABELS,
  EXPENSE_TYPE_LABELS,
  EXPENSE_STATUS_LABELS,
  EXPENSE_PAYMENT_METHOD_LABELS,
  CREDIT_STATUS_LABELS,
  CRATE_MOVEMENT_LABELS,
  CRATE_CLEANING_STATUS_LABELS,
} from "@/lib/labels";
import type { ReportKind, ReportResult } from "./report.types";
import { REPORT_LABELS } from "./report.types";

/**
 * Quantos dias sem pagamento tornam "cobrável" uma conta SEM data de
 * vencimento. Sem uma régua, "antigo" não é verificável.
 */
const DIAS_PARA_COBRAR_SEM_VENCIMENTO = 30;

interface Params {
  tenantId: string;
  from: Date;
  to: Date;
  /**
   * Qual data do lançamento o período filtra. Só o relatório de despesas usa.
   *
   * O padrão era `createdAt` — a data de CADASTRO. Lançar em fevereiro uma
   * conta de janeiro jogava a despesa no relatório de fevereiro, e o
   * contador recebia o mês errado. Agora o padrão é o vencimento, e o usuário
   * escolhe entre vencimento, pagamento e cadastro.
   */
  dateField?: "dueDate" | "paidDate" | "createdAt";
  /** Agrupa as linhas por categoria, com subtotal em cada grupo. */
  agruparPorCategoria?: boolean;
}

/** Como o período aparece no título e na coluna de data do relatório. */
const LABEL_CAMPO_DATA: Record<"dueDate" | "paidDate" | "createdAt", string> = {
  dueDate: "vencimento",
  paidDate: "pagamento",
  createdAt: "cadastro",
};

/** Linha de relatório que sabe a que categoria pertence. */
interface LinhaAgrupavel {
  categoria: string;
  amount: Prisma.Decimal;
  [key: string]: unknown;
}

/**
 * Reordena as linhas por categoria e insere um subtotal ao fim de cada grupo.
 *
 * É o formato que contador e gestor esperam ("Aluguel: R$ X, Energia: R$ Y").
 * O subtotal entra como uma LINHA comum, e não numa estrutura nova de grupos:
 * assim a tela, o Excel e o PDF continuam consumindo o mesmo `ReportResult`,
 * sem nenhuma mudança nos exportadores.
 */
function agruparPorCategoria<T extends LinhaAgrupavel>(linhas: T[]): Record<string, unknown>[] {
  const grupos = new Map<string, T[]>();
  for (const l of linhas) {
    const atual = grupos.get(l.categoria) ?? [];
    atual.push(l);
    grupos.set(l.categoria, atual);
  }

  const saida: Record<string, unknown>[] = [];
  for (const nome of [...grupos.keys()].sort((a, b) => a.localeCompare(b, "pt-BR"))) {
    const doGrupo = grupos.get(nome)!;
    saida.push(...doGrupo);
    saida.push({
      description: `Subtotal — ${nome}`,
      amount: add(...doGrupo.map((l) => l.amount)),
    });
  }
  return saida;
}

export async function buildReport(kind: ReportKind, p: Params): Promise<ReportResult> {
  const db = getTenantPrisma(p.tenantId);
  const base = {
    title: REPORT_LABELS[kind],
    period: { from: p.from, to: p.to },
    generatedAt: new Date(),
  };

  switch (kind) {
    case "VENDAS": {
      const vendas = await db.sale.findMany({
        where: { saleDate: { gte: p.from, lte: p.to }, cancelledAt: null },
        orderBy: { saleDate: "asc" },
      });
      return {
        ...base,
        columns: [
          { key: "saleDate", label: "Data", format: "date" },
          { key: "customerName", label: "Cliente" },
          { key: "paymentMethod", label: "Pagamento" },
          { key: "totalAmount", label: "Total", align: "right", format: "money" },
        ],
        rows: vendas.map((v) => ({
          saleDate: v.saleDate,
          customerName: v.customerName ?? "-",
          paymentMethod: PAYMENT_METHOD_LABELS[v.paymentMethod],
          totalAmount: v.totalAmount,
        })),
        totals: { customerName: "TOTAL", totalAmount: add(...vendas.map((v) => v.totalAmount)) },
      };
    }

    case "COMPRAS": {
      const compras = await db.purchase.findMany({
        where: { purchaseDate: { gte: p.from, lte: p.to } },
        include: { supplier: true, items: true },
        orderBy: { purchaseDate: "asc" },
      });
      return {
        ...base,
        columns: [
          { key: "purchaseDate", label: "Data", format: "date" },
          { key: "supplier", label: "Fornecedor" },
          { key: "items", label: "Itens", align: "right", format: "int" },
          { key: "totalAmount", label: "Total", align: "right", format: "money" },
        ],
        rows: compras.map((c) => ({
          purchaseDate: c.purchaseDate,
          supplier: c.supplier?.name ?? "-",
          items: c.items.length,
          totalAmount: c.totalAmount,
        })),
        totals: { supplier: "TOTAL", totalAmount: add(...compras.map((c) => c.totalAmount)) },
      };
    }

    case "FIADO": {
      const [contas, caixasPorCliente] = await Promise.all([
        db.creditAccount.findMany({
          where: { status: "EM_ABERTO" },
          include: { sale: { include: { items: { include: { product: true } } } } },
          orderBy: { createdAt: "asc" },
        }),
        CaixasService.saldoPorCliente(p.tenantId),
      ]);
      const rows = contas.map((c) => ({
        saleDate: c.sale?.saleDate ?? c.createdAt,
        customerName: c.customerName,
        produtos:
          c.sale?.items.map((i) => `${i.product.name} (${formatQty(i.quantity)})`).join(", ") ||
          "—",
        caixas: c.sale?.plasticCrateQty ?? 0,
        aDevolver: caixasPorCliente.get(c.customerName) ?? 0,
        totalAmount: c.totalAmount,
        paidAmount: c.paidAmount,
        saldo: FinancialCalc.saldoFiado(c.totalAmount, c.paidAmount),
        status: CREDIT_STATUS_LABELS[c.status],
      }));
      return {
        ...base,
        columns: [
          { key: "saleDate", label: "Venda", format: "date" },
          { key: "customerName", label: "Cliente" },
          { key: "produtos", label: "Produtos" },
          { key: "caixas", label: "Caixas", align: "right", format: "int" },
          { key: "aDevolver", label: "A devolver", align: "right", format: "int" },
          { key: "totalAmount", label: "Total", align: "right", format: "money" },
          { key: "paidAmount", label: "Pago", align: "right", format: "money" },
          { key: "saldo", label: "Saldo", align: "right", format: "money" },
        ],
        rows,
        totals: {
          customerName: "TOTAL",
          caixas: rows.reduce((a, r) => a + r.caixas, 0),
          // "A devolver" é por CLIENTE, e a linha é por conta — cada venda a
          // prazo abre uma conta. Somando linha a linha, o freguês com duas
          // compras em aberto entrava duas vezes e o rodapé mostrava o dobro de
          // caixas na rua. Mesma correção já feita na tela do fiado; o relatório
          // ficou de fora, e é ele que o comerciante usa para cobrar devolução.
          aDevolver: [...new Set(rows.map((r) => r.customerName))].reduce(
            (a, nome) => a + (caixasPorCliente.get(nome) ?? 0),
            0,
          ),
          saldo: add(...rows.map((r) => r.saldo)),
        },
      };
    }

    case "DESPESAS": {
      // Padrão: VENCIMENTO. Antes era `createdAt` — lançar em fevereiro uma
      // conta de janeiro jogava a despesa no mês errado, e era o relatório que
      // o contador recebia.
      const campo = p.dateField ?? "dueDate";
      const despesas = await db.expense.findMany({
        where: { [campo]: { gte: p.from, lte: p.to } },
        include: { category: true },
        orderBy: [{ [campo]: "asc" }],
      });
      const linhas = despesas.map((d) => ({
        categoria: d.category?.name ?? "Sem categoria",
        data: d[campo],
        description: d.description,
        category: d.category?.name ?? "-",
        type: EXPENSE_TYPE_LABELS[d.type],
        status: EXPENSE_STATUS_LABELS[d.status],
        paymentMethod: d.paymentMethod
          ? EXPENSE_PAYMENT_METHOD_LABELS[d.paymentMethod]
          : "-",
        amount: d.amount,
      }));
      return {
        ...base,
        title: `${REPORT_LABELS[kind]} (por ${LABEL_CAMPO_DATA[campo]})`,
        columns: [
          { key: "data", label: LABEL_CAMPO_DATA[campo], format: "date" },
          { key: "description", label: "Descricao" },
          { key: "category", label: "Categoria" },
          { key: "type", label: "Tipo" },
          { key: "status", label: "Situacao" },
          { key: "paymentMethod", label: "Forma" },
          { key: "amount", label: "Valor", align: "right", format: "money" },
        ],
        rows: p.agruparPorCategoria ? agruparPorCategoria(linhas) : linhas,
        totals: { description: "TOTAL", amount: add(...despesas.map((d) => d.amount)) },
      };
    }

    /**
     * Contas pagas no período — o que realmente SAIU do caixa.
     *
     * Separado do relatório de despesas de propósito: aquele mostra o que foi
     * lançado (inclusive o que ainda não foi pago), e é o que o contador e o IR
     * não querem. Aqui o recorte é a data de pagamento, e só o que está pago.
     */
    case "CONTAS_PAGAS": {
      const pagas = await db.expense.findMany({
        where: { status: "PAGO", paidDate: { gte: p.from, lte: p.to } },
        include: { category: true },
        orderBy: [{ paidDate: "asc" }],
      });
      const linhas = pagas.map((d) => ({
        categoria: d.category?.name ?? "Sem categoria",
        paidDate: d.paidDate,
        description: d.description,
        category: d.category?.name ?? "-",
        type: EXPENSE_TYPE_LABELS[d.type],
        paymentMethod: d.paymentMethod
          ? EXPENSE_PAYMENT_METHOD_LABELS[d.paymentMethod]
          : "-",
        dueDate: d.dueDate,
        amount: d.amount,
      }));
      return {
        ...base,
        columns: [
          { key: "paidDate", label: "Pagamento", format: "date" },
          { key: "description", label: "Descricao" },
          { key: "category", label: "Categoria" },
          { key: "type", label: "Tipo" },
          { key: "paymentMethod", label: "Forma" },
          { key: "dueDate", label: "Vencimento", format: "date" },
          { key: "amount", label: "Valor", align: "right", format: "money" },
        ],
        rows: p.agruparPorCategoria ? agruparPorCategoria(linhas) : linhas,
        totals: { description: "TOTAL PAGO", amount: add(...pagas.map((d) => d.amount)) },
      };
    }

    case "ESTOQUE": {
      const posicoes = await EstoqueService.getPositions(p.tenantId);
      return {
        ...base,
        columns: [
          { key: "name", label: "Produto" },
          { key: "quantity", label: "Quantidade", align: "right", format: "qty" },
          { key: "value", label: "Valor", align: "right", format: "money" },
        ],
        rows: posicoes.map((p2) => ({
          name: p2.name,
          quantity: p2.quantity,
          value: p2.value,
        })),
        totals: { name: "TOTAL", value: add(...posicoes.map((x) => x.value)) },
      };
    }

    // Avancados (Fase 2)

    case "LUCRO_PRODUTO": {
      // Receita, custo (snapshot na venda) e lucro por produto no periodo.
      const rows = await prisma.$queryRaw<
        { name: string; qtd: Prisma.Decimal; receita: Prisma.Decimal; custo: Prisma.Decimal }[]
      >`
        SELECT pr.name AS name,
               COALESCE(SUM(si.quantity), 0) AS qtd,
               COALESCE(SUM(si."lineTotal"), 0) AS receita,
               COALESCE(SUM(si.quantity * si."unitCostAtSale"), 0) AS custo
        FROM sale_items si
        JOIN sales s ON s.id = si."saleId"
        JOIN products pr ON pr.id = si."productId"
        WHERE si."tenantId" = ${p.tenantId} AND s."deletedAt" IS NULL AND s."cancelledAt" IS NULL
          AND s."saleDate" >= ${p.from} AND s."saleDate" <= ${p.to}
        GROUP BY pr.name
        ORDER BY (COALESCE(SUM(si."lineTotal"), 0) - COALESCE(SUM(si.quantity * si."unitCostAtSale"), 0)) DESC
      `;
      const mapped = rows.map((r) => ({
        name: r.name,
        qtd: toDecimal(r.qtd),
        receita: money(toDecimal(r.receita)),
        custo: money(toDecimal(r.custo)),
        lucro: money(sub(r.receita, r.custo)),
      }));
      return {
        ...base,
        columns: [
          { key: "name", label: "Produto" },
          { key: "qtd", label: "Qtd. vendida", align: "right", format: "qty" },
          { key: "receita", label: "Receita", align: "right", format: "money" },
          { key: "custo", label: "Custo", align: "right", format: "money" },
          { key: "lucro", label: "Lucro", align: "right", format: "money" },
        ],
        rows: mapped,
        totals: {
          name: "TOTAL",
          receita: add(...mapped.map((m) => m.receita)),
          custo: add(...mapped.map((m) => m.custo)),
          lucro: add(...mapped.map((m) => m.lucro)),
        },
      };
    }

    case "MAIS_VENDIDOS": {
      const rows = await prisma.$queryRaw<
        { name: string; qtd: Prisma.Decimal; receita: Prisma.Decimal }[]
      >`
        SELECT pr.name AS name,
               COALESCE(SUM(si.quantity), 0) AS qtd,
               COALESCE(SUM(si."lineTotal"), 0) AS receita
        FROM sale_items si
        JOIN sales s ON s.id = si."saleId"
        JOIN products pr ON pr.id = si."productId"
        WHERE si."tenantId" = ${p.tenantId} AND s."deletedAt" IS NULL AND s."cancelledAt" IS NULL
          AND s."saleDate" >= ${p.from} AND s."saleDate" <= ${p.to}
        GROUP BY pr.name
        ORDER BY COALESCE(SUM(si.quantity), 0) DESC
        LIMIT 50
      `;
      return {
        ...base,
        columns: [
          { key: "name", label: "Produto" },
          { key: "qtd", label: "Qtd. vendida", align: "right", format: "qty" },
          { key: "receita", label: "Receita", align: "right", format: "money" },
        ],
        rows: rows.map((r) => ({
          name: r.name,
          qtd: toDecimal(r.qtd),
          receita: money(toDecimal(r.receita)),
        })),
        totals: { name: "TOTAL", receita: add(...rows.map((r) => r.receita)) },
      };
    }

    case "LUCRO_FORNECEDOR": {
      const rows = await prisma.$queryRaw<
        {
          supplier: string;
          compras: Prisma.Decimal;
          receita: Prisma.Decimal;
          custo: Prisma.Decimal;
        }[]
      >`
        WITH last_supplier AS (
          SELECT DISTINCT ON (pi."productId")
                 pi."productId",
                 COALESCE(pu."supplierId", '__sem_fornecedor__') AS supplier_key,
                 COALESCE(su.name, 'Sem fornecedor') AS supplier
          FROM purchase_items pi
          JOIN purchases pu ON pu.id = pi."purchaseId"
          LEFT JOIN suppliers su ON su.id = pu."supplierId"
          WHERE pi."tenantId" = ${p.tenantId}
            AND pu."deletedAt" IS NULL
            AND pu."purchaseDate" <= ${p.to}
          ORDER BY pi."productId", pu."purchaseDate" DESC, pu."createdAt" DESC
        ),
        sales_by_supplier AS (
          SELECT ls.supplier_key,
                 ls.supplier,
                 COALESCE(SUM(si."lineTotal"), 0) AS receita,
                 COALESCE(SUM(si.quantity * si."unitCostAtSale"), 0) AS custo
          FROM sale_items si
          JOIN sales sa ON sa.id = si."saleId"
          JOIN last_supplier ls ON ls."productId" = si."productId"
          WHERE si."tenantId" = ${p.tenantId}
            AND sa."deletedAt" IS NULL AND sa."cancelledAt" IS NULL
            AND sa."saleDate" >= ${p.from}
            AND sa."saleDate" <= ${p.to}
          GROUP BY ls.supplier_key, ls.supplier
        ),
        purchases_by_supplier AS (
          SELECT COALESCE(pu."supplierId", '__sem_fornecedor__') AS supplier_key,
                 COALESCE(su.name, 'Sem fornecedor') AS supplier,
                 COALESCE(SUM(pi."lineTotal" + pi."freightShare"), 0) AS compras
          FROM purchase_items pi
          JOIN purchases pu ON pu.id = pi."purchaseId"
          LEFT JOIN suppliers su ON su.id = pu."supplierId"
          WHERE pi."tenantId" = ${p.tenantId}
            AND pu."deletedAt" IS NULL
            AND pu."purchaseDate" >= ${p.from}
            AND pu."purchaseDate" <= ${p.to}
          GROUP BY COALESCE(pu."supplierId", '__sem_fornecedor__'), COALESCE(su.name, 'Sem fornecedor')
        )
        SELECT COALESCE(pb.supplier, sb.supplier, 'Sem fornecedor') AS supplier,
               COALESCE(pb.compras, 0) AS compras,
               COALESCE(sb.receita, 0) AS receita,
               COALESCE(sb.custo, 0) AS custo
        FROM purchases_by_supplier pb
        FULL OUTER JOIN sales_by_supplier sb ON sb.supplier_key = pb.supplier_key
        ORDER BY (COALESCE(sb.receita, 0) - COALESCE(sb.custo, 0)) DESC,
                 COALESCE(pb.compras, 0) DESC
      `;
      const mapped = rows.map((r) => ({
        supplier: r.supplier,
        compras: money(toDecimal(r.compras)),
        receita: money(toDecimal(r.receita)),
        custo: money(toDecimal(r.custo)),
        lucro: money(sub(r.receita, r.custo)),
      }));
      return {
        ...base,
        columns: [
          { key: "supplier", label: "Fornecedor" },
          { key: "compras", label: "Comprado", align: "right", format: "money" },
          { key: "receita", label: "Receita vendida", align: "right", format: "money" },
          { key: "custo", label: "Custo vendido", align: "right", format: "money" },
          { key: "lucro", label: "Lucro bruto", align: "right", format: "money" },
        ],
        rows: mapped,
        totals: {
          supplier: "TOTAL",
          compras: add(...mapped.map((r) => r.compras)),
          receita: add(...mapped.map((r) => r.receita)),
          custo: add(...mapped.map((r) => r.custo)),
          lucro: add(...mapped.map((r) => r.lucro)),
        },
      };
    }

    case "PRODUTOS_PREJUIZO": {
      const rows = await prisma.$queryRaw<
        { name: string; qtd: Prisma.Decimal; receita: Prisma.Decimal; custo: Prisma.Decimal }[]
      >`
        SELECT pr.name AS name,
               COALESCE(SUM(si.quantity), 0) AS qtd,
               COALESCE(SUM(si."lineTotal"), 0) AS receita,
               COALESCE(SUM(si.quantity * si."unitCostAtSale"), 0) AS custo
        FROM sale_items si
        JOIN sales s ON s.id = si."saleId"
        JOIN products pr ON pr.id = si."productId"
        WHERE si."tenantId" = ${p.tenantId}
          AND s."deletedAt" IS NULL AND s."cancelledAt" IS NULL
          AND s."saleDate" >= ${p.from}
          AND s."saleDate" <= ${p.to}
        GROUP BY pr.name
        HAVING (COALESCE(SUM(si."lineTotal"), 0) - COALESCE(SUM(si.quantity * si."unitCostAtSale"), 0)) < 0
        ORDER BY (COALESCE(SUM(si."lineTotal"), 0) - COALESCE(SUM(si.quantity * si."unitCostAtSale"), 0)) ASC
      `;
      const mapped = rows.map((r) => ({
        name: r.name,
        qtd: toDecimal(r.qtd),
        receita: money(toDecimal(r.receita)),
        custo: money(toDecimal(r.custo)),
        prejuizo: money(sub(r.receita, r.custo)),
      }));
      return {
        ...base,
        columns: [
          { key: "name", label: "Produto" },
          { key: "qtd", label: "Qtd. vendida", align: "right", format: "qty" },
          { key: "receita", label: "Receita", align: "right", format: "money" },
          { key: "custo", label: "Custo", align: "right", format: "money" },
          { key: "prejuizo", label: "Resultado", align: "right", format: "money" },
        ],
        rows: mapped,
        totals: {
          name: "TOTAL",
          receita: add(...mapped.map((r) => r.receita)),
          custo: add(...mapped.map((r) => r.custo)),
          prejuizo: add(...mapped.map((r) => r.prejuizo)),
        },
      };
    }

    case "ESTOQUE_PARADO": {
      const rows = await prisma.$queryRaw<
        {
          name: string;
          quantity: Prisma.Decimal;
          value: Prisma.Decimal;
          lastMovementAt: Date | null;
          lastSaleAt: Date | null;
        }[]
      >`
        WITH saldo AS (
          SELECT "productId",
                 COALESCE(SUM(CASE WHEN type IN ('ENTRADA','AJUSTE') THEN quantity ELSE -quantity END), 0) AS quantity,
                 COALESCE(SUM(CASE WHEN type IN ('ENTRADA','AJUSTE') THEN quantity ELSE -quantity END * COALESCE("unitCost", 0)), 0) AS value,
                 MAX("movedAt") AS "lastMovementAt"
          FROM stock_movements
          WHERE "tenantId" = ${p.tenantId}
          GROUP BY "productId"
        ),
        last_sale AS (
          SELECT si."productId", MAX(sa."saleDate") AS "lastSaleAt"
          FROM sale_items si
          JOIN sales sa ON sa.id = si."saleId"
          WHERE si."tenantId" = ${p.tenantId}
            AND sa."deletedAt" IS NULL AND sa."cancelledAt" IS NULL
          GROUP BY si."productId"
        )
        SELECT pr.name AS name,
               saldo.quantity AS quantity,
               saldo.value AS value,
               saldo."lastMovementAt" AS "lastMovementAt",
               last_sale."lastSaleAt" AS "lastSaleAt"
        FROM saldo
        JOIN products pr ON pr.id = saldo."productId"
        LEFT JOIN last_sale ON last_sale."productId" = saldo."productId"
        WHERE pr."tenantId" = ${p.tenantId}
          AND pr."deletedAt" IS NULL
          AND saldo.quantity > 0
          AND (last_sale."lastSaleAt" IS NULL OR last_sale."lastSaleAt" < ${p.from})
        ORDER BY last_sale."lastSaleAt" ASC NULLS FIRST, saldo."lastMovementAt" ASC NULLS FIRST, pr.name ASC
      `;
      const mapped = rows.map((r) => ({
        name: r.name,
        quantity: toDecimal(r.quantity),
        value: money(toDecimal(r.value)),
        lastSaleAt: r.lastSaleAt,
        lastMovementAt: r.lastMovementAt,
      }));
      return {
        ...base,
        columns: [
          { key: "name", label: "Produto" },
          { key: "quantity", label: "Saldo", align: "right", format: "qty" },
          { key: "value", label: "Valor em estoque", align: "right", format: "money" },
          { key: "lastSaleAt", label: "Ultima venda", format: "date" },
          { key: "lastMovementAt", label: "Ultimo movimento", format: "date" },
        ],
        rows: mapped,
        totals: {
          name: "TOTAL",
          value: add(...mapped.map((r) => r.value)),
        },
      };
    }

    case "CAIXAS_PAPELAO": {
      const rows = await prisma.$queryRaw<
        {
          date: Date;
          source: string;
          product: string;
          party: string;
          entrada: Prisma.Decimal;
          saida: Prisma.Decimal;
          total: Prisma.Decimal;
        }[]
      >`
        SELECT pu."purchaseDate" AS date,
               'Compra' AS source,
               pr.name AS product,
               COALESCE(su.name, 'Sem fornecedor') AS party,
               COALESCE(pi.quantity, 0) AS entrada,
               0::numeric AS saida,
               COALESCE(pi."lineTotal", 0) AS total
        FROM purchase_items pi
        JOIN purchases pu ON pu.id = pi."purchaseId"
        JOIN products pr ON pr.id = pi."productId"
        LEFT JOIN suppliers su ON su.id = pu."supplierId"
        WHERE pi."tenantId" = ${p.tenantId}
          AND pu."deletedAt" IS NULL
          AND pu."purchaseDate" >= ${p.from}
          AND pu."purchaseDate" <= ${p.to}
          AND COALESCE(pi."recipientType", pr."recipientType") = 'PAPELAO'

        UNION ALL

        SELECT sa."saleDate" AS date,
               'Venda' AS source,
               pr.name AS product,
               COALESCE(sa."customerName", 'Sem cliente') AS party,
               0::numeric AS entrada,
               COALESCE(si.quantity, 0) AS saida,
               COALESCE(si."lineTotal", 0) AS total
        FROM sale_items si
        JOIN sales sa ON sa.id = si."saleId"
        JOIN products pr ON pr.id = si."productId"
        WHERE si."tenantId" = ${p.tenantId}
          AND sa."deletedAt" IS NULL AND sa."cancelledAt" IS NULL
          AND sa."saleDate" >= ${p.from}
          AND sa."saleDate" <= ${p.to}
          AND COALESCE(si."recipientType", pr."recipientType") = 'PAPELAO'

        UNION ALL

        SELECT ps."saleDate" AS date,
               'Venda embalagem' AS source,
               pt.name AS product,
               COALESCE(ps."customerName", 'Sem cliente') AS party,
               0::numeric AS entrada,
               COALESCE(ps.quantity, 0)::numeric AS saida,
               COALESCE(ps."totalAmount", 0) AS total
        FROM packaging_sales ps
        JOIN packaging_types pt ON pt.id = ps."packagingTypeId"
        WHERE ps."tenantId" = ${p.tenantId}
          AND ps."deletedAt" IS NULL
          AND ps."saleDate" >= ${p.from}
          AND ps."saleDate" <= ${p.to}
          AND pt.name ILIKE '%papel%'

        ORDER BY date ASC, source ASC, product ASC
      `;
      const mapped = rows.map((r) => ({
        date: r.date,
        source: r.source,
        product: r.product,
        party: r.party,
        entrada: toDecimal(r.entrada),
        saida: toDecimal(r.saida),
        total: money(toDecimal(r.total)),
      }));
      return {
        ...base,
        columns: [
          { key: "date", label: "Data", format: "date" },
          { key: "source", label: "Origem" },
          { key: "product", label: "Produto/tipo" },
          { key: "party", label: "Fornecedor/cliente" },
          { key: "entrada", label: "Entradas", align: "right", format: "qty" },
          { key: "saida", label: "Saidas", align: "right", format: "qty" },
          { key: "total", label: "Valor", align: "right", format: "money" },
        ],
        rows: mapped,
        totals: {
          source: "TOTAL",
          entrada: add(...mapped.map((r) => r.entrada)),
          saida: add(...mapped.map((r) => r.saida)),
          total: add(...mapped.map((r) => r.total)),
        },
      };
    }

    case "INADIMPLENTES": {
      /**
       * Fiado em aberto e vencido. Três defeitos corrigidos aqui.
       *
       * 1. `dueDate: { lt: ... }` EXCLUI `NULL` no Prisma — e a maioria das
       *    contas nasce sem vencimento (o PDV só o envia quando há parte fiada
       *    E o operador digita a data). Ou seja, o relatório de inadimplentes
       *    não mostrava a maior parte dos inadimplentes, apesar de o comentário
       *    prometer "(ou sem vencimento e antigo)".
       *
       * 2. `p.from`/`p.to` eram ignorados: o cabeçalho dizia "Período: 01/09 a
       *    30/09" e o conteúdo era o histórico inteiro.
       *
       * 3. `new Date()` em vez do início do dia no fuso do app fazia uma conta
       *    que vence HOJE aparecer como atrasada durante todo o dia. A tela do
       *    fiado usa `startOfDayTz` — as duas discordavam.
       *
       * "Sem vencimento e antigo" ganhou régua explícita: mais de 30 dias desde
       * a abertura. Sem uma régua, "antigo" não é verificável.
       */
      const hoje = startOfDayTz(new Date());
      const limiteSemVencimento = addDaysTz(hoje, -DIAS_PARA_COBRAR_SEM_VENCIMENTO);
      const contas = await db.creditAccount.findMany({
        where: {
          status: "EM_ABERTO",
          // O período filtra pela ABERTURA da conta: `dueDate` pode ser nulo, e
          // filtrar por ele deixaria de fora justamente quem não tem data.
          createdAt: { gte: p.from, lte: p.to },
          OR: [
            { dueDate: { lt: hoje } },
            { dueDate: null, createdAt: { lt: limiteSemVencimento } },
          ],
        },
        orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      });
      const rows = contas.map((c) => ({
        customerName: c.customerName,
        dueDate: c.dueDate,
        abertaEm: c.createdAt,
        totalAmount: c.totalAmount,
        paidAmount: c.paidAmount,
        saldo: FinancialCalc.saldoFiado(c.totalAmount, c.paidAmount),
      }));
      return {
        ...base,
        columns: [
          { key: "customerName", label: "Cliente" },
          { key: "dueDate", label: "Vencimento", format: "date" },
          { key: "abertaEm", label: "Aberta em", format: "date" },
          { key: "totalAmount", label: "Total", align: "right", format: "money" },
          { key: "paidAmount", label: "Pago", align: "right", format: "money" },
          { key: "saldo", label: "Em atraso", align: "right", format: "money" },
        ],
        rows,
        totals: { customerName: "TOTAL", saldo: add(...rows.map((r) => r.saldo)) },
      };
    }

    case "FORNECEDORES": {
      const compras = await db.purchase.findMany({
        where: { purchaseDate: { gte: p.from, lte: p.to } },
        include: { supplier: true },
      });
      const porFornecedor = new Map<string, { name: string; compras: number; total: Prisma.Decimal }>();
      for (const c of compras) {
        const key = c.supplier?.name ?? "Sem fornecedor";
        const cur = porFornecedor.get(key) ?? { name: key, compras: 0, total: toDecimal(0) };
        cur.compras += 1;
        cur.total = add(cur.total, c.totalAmount);
        porFornecedor.set(key, cur);
      }
      const rows = [...porFornecedor.values()].sort((a, b) =>
        b.total.comparedTo(a.total),
      );
      return {
        ...base,
        columns: [
          { key: "name", label: "Fornecedor" },
          { key: "compras", label: "Compras", align: "right", format: "int" },
          { key: "total", label: "Total comprado", align: "right", format: "money" },
        ],
        rows,
        totals: { name: "TOTAL", total: add(...rows.map((r) => r.total)) },
      };
    }

    case "FLUXO_CAIXA": {
      // Entradas = vendas à vista + recebimentos de fiado + venda de embalagens.
      // Saidas = compras + despesas pagas (sem o frete já embutido na compra) +
      // pagamentos de higienizacao.
      // Agrupa pelo dia BRASILEIRO. As colunas são `timestamp` sem fuso guardando
      // UTC, então truncar direto jogava o movimento das 21h em diante para o dia
      // seguinte — o fluxo de caixa nunca fechava com o do balcão.
      const dayExpr = (col: string) =>
        Prisma.raw(`DATE_TRUNC('day', ${col} AT TIME ZONE 'UTC' AT TIME ZONE '${APP_TIME_ZONE}')::date`);
      const [vendasVista, recebFiado, vendEmb, compras, despesasPagas, pagHig] =
        await Promise.all([
          // Entrada de venda: o que NÃO foi fiado.
          //
          // Com pagamento misto ("metade PIX, metade fiado") nem `totalAmount`
          // nem `paymentMethod` respondem sozinhos: a venda fica marcada como
          // FIADO e o PIX sumiria do caixa. Então quando a venda tem parcelas
          // registradas, valem as parcelas; as vendas antigas (sem parcela
          // nenhuma) continuam pelo total, como antes.
          prisma.$queryRaw<{ d: Date; total: Prisma.Decimal }[]>`
            SELECT d, SUM(total) AS total FROM (
              SELECT ${dayExpr('s."saleDate"')} AS d, s."totalAmount" AS total
              FROM sales s
              WHERE s."tenantId" = ${p.tenantId} AND s."deletedAt" IS NULL
                AND s."cancelledAt" IS NULL AND s."paymentMethod" <> 'FIADO'
                AND s."saleDate" >= ${p.from} AND s."saleDate" <= ${p.to}
                AND NOT EXISTS (SELECT 1 FROM sale_payments sp WHERE sp."saleId" = s.id)
              UNION ALL
              SELECT ${dayExpr('s."saleDate"')} AS d, sp.amount AS total
              FROM sale_payments sp
              JOIN sales s ON s.id = sp."saleId"
              WHERE s."tenantId" = ${p.tenantId} AND s."deletedAt" IS NULL
                AND s."cancelledAt" IS NULL AND sp.method <> 'FIADO'
                AND s."saleDate" >= ${p.from} AND s."saleDate" <= ${p.to}
            ) entradas_de_venda
            GROUP BY 1`,
          prisma.$queryRaw<{ d: Date; total: Prisma.Decimal }[]>`
            SELECT ${dayExpr('"paidAt"')} AS d, SUM(amount) AS total FROM credit_payments
            WHERE "tenantId" = ${p.tenantId}
              AND "paidAt" >= ${p.from} AND "paidAt" <= ${p.to} GROUP BY 1`,
          prisma.$queryRaw<{ d: Date; total: Prisma.Decimal }[]>`
            SELECT ${dayExpr('"saleDate"')} AS d, SUM("totalAmount") AS total FROM packaging_sales
            WHERE "tenantId" = ${p.tenantId} AND "deletedAt" IS NULL
              AND "saleDate" >= ${p.from} AND "saleDate" <= ${p.to} GROUP BY 1`,
          prisma.$queryRaw<{ d: Date; total: Prisma.Decimal }[]>`
            SELECT ${dayExpr('"purchaseDate"')} AS d, SUM("totalAmount") AS total FROM purchases
            WHERE "tenantId" = ${p.tenantId} AND "deletedAt" IS NULL
              AND "purchaseDate" >= ${p.from} AND "purchaseDate" <= ${p.to} GROUP BY 1`,
          prisma.$queryRaw<{ d: Date; total: Prisma.Decimal }[]>`
            SELECT ${dayExpr('"paidDate"')} AS d, SUM(amount) AS total FROM expenses
            WHERE "tenantId" = ${p.tenantId} AND "deletedAt" IS NULL AND "paidDate" IS NOT NULL
              AND "purchaseId" IS NULL
              AND "paidDate" >= ${p.from} AND "paidDate" <= ${p.to} GROUP BY 1`,
          // Soma os PAGAMENTOS, não o acumulado do lote.
          //
          // Era SUM("paidAmount") agrupado por "paidDate" em crate_cleanings,
          // onde paidAmount é ACUMULADO e paidDate guarda só a data do ÚLTIMO
          // pagamento. Pagamento parcelado ao higienizador jogava o valor cheio
          // do lote no dia do último, deixava o dia do primeiro sem despesa
          // nenhuma e, se o último caía fora do período, sumia com o lote
          // inteiro — o mês fechava com saída menor que a real (lucro inflado),
          // e é o número que vai para o contador.
          //
          // crate_cleaning_payments tem uma linha por pagamento, como
          // credit_payments já tinha para o fiado. O lote soft-deletado sai pelo
          // JOIN: a linha de pagamento não tem deletedAt própria.
          prisma.$queryRaw<{ d: Date; total: Prisma.Decimal }[]>`
            SELECT ${dayExpr('pg."paidAt"')} AS d, SUM(pg.amount) AS total
            FROM crate_cleaning_payments pg
            JOIN crate_cleanings cc ON cc.id = pg."cleaningId"
            WHERE pg."tenantId" = ${p.tenantId} AND cc."deletedAt" IS NULL
              AND pg."paidAt" >= ${p.from} AND pg."paidAt" <= ${p.to} GROUP BY 1`,
        ]);

      const days = new Map<string, { entradas: Prisma.Decimal; saidas: Prisma.Decimal }>();
      const bump = (list: { d: Date; total: Prisma.Decimal }[], kind: "entradas" | "saidas") => {
        for (const r of list) {
          const key = new Date(r.d).toISOString().slice(0, 10);
          const cur = days.get(key) ?? { entradas: toDecimal(0), saidas: toDecimal(0) };
          cur[kind] = add(cur[kind], r.total ?? 0);
          days.set(key, cur);
        }
      };
      bump(vendasVista, "entradas");
      bump(recebFiado, "entradas");
      bump(vendEmb, "entradas");
      bump(compras, "saidas");
      bump(despesasPagas, "saidas");
      bump(pagHig, "saidas");

      const rows = [...days.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => ({
          date: new Date(key + "T12:00:00"),
          entradas: money(v.entradas),
          saidas: money(v.saidas),
          saldo: money(sub(v.entradas, v.saidas)),
        }));
      return {
        ...base,
        columns: [
          { key: "date", label: "Dia", format: "date" },
          { key: "entradas", label: "Entradas", align: "right", format: "money" },
          { key: "saidas", label: "Saidas", align: "right", format: "money" },
          { key: "saldo", label: "Saldo do dia", align: "right", format: "money" },
        ],
        rows,
        totals: {
          date: "TOTAL",
          entradas: add(...rows.map((r) => r.entradas)),
          saidas: add(...rows.map((r) => r.saidas)),
          saldo: add(...rows.map((r) => r.saldo)),
        },
      };
    }

    case "CAIXAS_PLASTICAS": {
      const [movimentos, saldo] = await Promise.all([
        db.plasticCrateMovement.findMany({
          where: { movementDate: { gte: p.from, lte: p.to } },
          orderBy: { movementDate: "asc" },
        }),
        CaixasService.getSaldo(p.tenantId),
      ]);
      const rows = movimentos.map((m) => ({
        movementDate: m.movementDate,
        type: CRATE_MOVEMENT_LABELS[m.type],
        quantity: m.quantity,
        brokenQty: m.brokenQty,
        who: m.customerName ?? m.cleanerName ?? m.supplierName ?? "—",
      }));
      return {
        ...base,
        columns: [
          { key: "movementDate", label: "Data", format: "date" },
          { key: "type", label: "Tipo" },
          { key: "who", label: "Cliente/Higienizador/Origem" },
          { key: "quantity", label: "Qtd.", align: "right", format: "int" },
          { key: "brokenQty", label: "Quebradas", align: "right", format: "int" },
        ],
        rows,
        totals: {
          type:
            `Saldo: ${saldo.limpas} limpas · ${saldo.sujas} sujas · ` +
            `${saldo.emHigienizacao} em higienização · ${saldo.comClientes} c/ clientes · ` +
            `${saldo.perdidas} perdidas`,
        },
      };
    }

    case "HIGIENIZACAO": {
      const [registros, saldo] = await Promise.all([
        db.crateCleaning.findMany({
          where: { sentDate: { gte: p.from, lte: p.to } },
          orderBy: { sentDate: "asc" },
        }),
        CaixasService.getSaldo(p.tenantId),
      ]);
      // As caixas PERDIDAS no higienizador entram na conta.
      //
      // O relatório fazia `sentQty − returnedQty` e o serviço faz
      // `sentQty − returnedQty − perdidas` (`higienizacao.service.ts`). Com 50
      // enviadas, 47 devolvidas e 3 registradas como perdidas, a tela dizia
      // "0 a receber, lote resolvido" e o PDF exportado para o mesmo período
      // dizia "3 a receber". Duas respostas para a mesma pergunta — e a do PDF
      // é a que vai para o higienizador cobrar caixa que ele já pagou.
      //
      // A perda não é coluna: é um movimento `QUEBRA` ligado ao lote. Usar a
      // MESMA função do serviço mantém uma fonte só.
      const perdas = await perdasPorLote(
        db,
        registros.map((c) => c.id),
      );
      const rows = registros.map((c) => ({
        sentDate: c.sentDate,
        cleanerName: c.cleanerName,
        status: CRATE_CLEANING_STATUS_LABELS[c.status],
        sentQty: c.sentQty,
        returnedQty: c.returnedQty,
        perdidas: perdas.get(c.id) ?? 0,
        aReceber: Math.max(0, c.sentQty - c.returnedQty - (perdas.get(c.id) ?? 0)),
        totalAmount: c.totalAmount,
        paidAmount: c.paidAmount,
        aPagar: money(sub(c.totalAmount, c.paidAmount)),
      }));
      return {
        ...base,
        columns: [
          { key: "sentDate", label: "Envio", format: "date" },
          { key: "cleanerName", label: "Higienizador" },
          { key: "status", label: "Situacao" },
          { key: "sentQty", label: "Enviadas", align: "right", format: "int" },
          { key: "returnedQty", label: "Devolvidas", align: "right", format: "int" },
          { key: "perdidas", label: "Perdidas", align: "right", format: "int" },
          { key: "aReceber", label: "A receber", align: "right", format: "int" },
          { key: "totalAmount", label: "Total", align: "right", format: "money" },
          { key: "paidAmount", label: "Pago", align: "right", format: "money" },
          { key: "aPagar", label: "A pagar", align: "right", format: "money" },
        ],
        rows,
        totals: {
          cleanerName: "TOTAL",
          status: `Estoque: ${saldo.sujas} sujas · ${saldo.emHigienizacao} em higienização · ${saldo.limpas} limpas`,
          sentQty: rows.reduce((a, r) => a + r.sentQty, 0),
          returnedQty: rows.reduce((a, r) => a + r.returnedQty, 0),
          perdidas: rows.reduce((a, r) => a + r.perdidas, 0),
          aReceber: rows.reduce((a, r) => a + r.aReceber, 0),
          totalAmount: add(...rows.map((r) => r.totalAmount)),
          paidAmount: add(...rows.map((r) => r.paidAmount)),
          aPagar: add(...rows.map((r) => r.aPagar)),
        },
      };
    }

    case "EMBALAGENS": {
      const vendas = await db.packagingSale.findMany({
        where: { saleDate: { gte: p.from, lte: p.to } },
        include: { type: true },
        orderBy: { saleDate: "asc" },
      });
      const rows = vendas.map((v) => ({
        saleDate: v.saleDate,
        type: v.type.name,
        customerName: v.customerName ?? "—",
        quantity: v.quantity,
        unitPrice: v.unitPrice,
        totalAmount: v.totalAmount,
      }));
      return {
        ...base,
        columns: [
          { key: "saleDate", label: "Data", format: "date" },
          { key: "type", label: "Tipo" },
          { key: "customerName", label: "Cliente" },
          { key: "quantity", label: "Qtd.", align: "right", format: "int" },
          { key: "unitPrice", label: "Unitario", align: "right", format: "money" },
          { key: "totalAmount", label: "Total", align: "right", format: "money" },
        ],
        rows,
        totals: {
          type: "TOTAL",
          quantity: rows.reduce((a, r) => a + r.quantity, 0),
          totalAmount: add(...rows.map((r) => r.totalAmount)),
        },
      };
    }
  }
}
