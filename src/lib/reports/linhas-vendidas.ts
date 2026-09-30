import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { FinancialCalc } from "@/lib/services/financial-calc.service";
import { add, money, toDecimal } from "@/lib/money";

/**
 * Uma linha vendida com a receita JÁ LÍQUIDA do desconto da venda.
 *
 * É a fonte única de "receita por produto" do sistema — relatórios de
 * lucratividade, mais vendidos, caixas de papelão e os rankings do painel.
 * Todos somavam `sale_items.lineTotal` cru, que é líquido só do desconto da
 * LINHA: com um desconto na venda, a receita por produto ficava acima do total
 * vendido e "Com prejuízo" deixava de apontar a venda que deu prejuízo. O
 * rateio em si é {@link FinancialCalc.receitaLiquidaPorLinha}.
 */
export interface LinhaVendida {
  saleId: string;
  productId: string;
  productName: string;
  saleDate: Date;
  customerName: string | null;
  /** `COALESCE(item.recipientType, produto.recipientType)`. */
  recipientType: string | null;
  quantity: Prisma.Decimal;
  /** Receita da linha, com o desconto da venda rateado. */
  receita: Prisma.Decimal;
  /** Custo da linha: quantidade × custo gravado na venda. */
  custo: Prisma.Decimal;
}

interface LinhaCrua {
  saleId: string;
  productId: string;
  productName: string;
  saleDate: Date;
  customerName: string | null;
  recipientType: string | null;
  quantity: Prisma.Decimal | string;
  lineTotal: Prisma.Decimal | string;
  custo: Prisma.Decimal | string;
  totalAmount: Prisma.Decimal | string;
}

/**
 * Todas as linhas das vendas válidas (não excluídas, não canceladas) com
 * `saleDate` em [from, to].
 *
 * Carrega a venda INTEIRA mesmo quando o chamador só quer parte das linhas
 * (caixas de papelão): o rateio precisa de todas as linhas da venda para saber
 * a fatia de cada uma.
 */
export async function linhasVendidas(
  tenantId: string,
  from: Date,
  to: Date,
): Promise<LinhaVendida[]> {
  const rows = await prisma.$queryRaw<LinhaCrua[]>`
    SELECT si."saleId" AS "saleId",
           si."productId" AS "productId",
           pr.name AS "productName",
           s."saleDate" AS "saleDate",
           s."customerName" AS "customerName",
           COALESCE(si."recipientType", pr."recipientType")::text AS "recipientType",
           si.quantity AS quantity,
           si."lineTotal" AS "lineTotal",
           si.quantity * si."unitCostAtSale" AS custo,
           s."totalAmount" AS "totalAmount"
    FROM sale_items si
    JOIN sales s ON s.id = si."saleId"
    JOIN products pr ON pr.id = si."productId"
    WHERE si."tenantId" = ${tenantId} AND s."tenantId" = ${tenantId}
      AND s."deletedAt" IS NULL AND s."cancelledAt" IS NULL
      AND s."saleDate" >= ${from} AND s."saleDate" <= ${to}
    ORDER BY s."saleDate" ASC, s.id ASC, si.id ASC
  `;

  const porVenda = new Map<string, LinhaCrua[]>();
  for (const r of rows) {
    const doGrupo = porVenda.get(r.saleId);
    if (doGrupo) doGrupo.push(r);
    else porVenda.set(r.saleId, [r]);
  }

  const saida: LinhaVendida[] = [];
  for (const linhas of porVenda.values()) {
    const receitas = FinancialCalc.receitaLiquidaPorLinha(
      linhas.map((l) => toDecimal(l.lineTotal as Prisma.Decimal.Value)),
      toDecimal(linhas[0]!.totalAmount as Prisma.Decimal.Value),
    );
    linhas.forEach((l, i) => {
      saida.push({
        saleId: l.saleId,
        productId: l.productId,
        productName: l.productName,
        saleDate: l.saleDate,
        customerName: l.customerName,
        recipientType: l.recipientType,
        quantity: toDecimal(l.quantity as Prisma.Decimal.Value),
        receita: receitas[i]!,
        custo: toDecimal(l.custo as Prisma.Decimal.Value),
      });
    });
  }
  return saida;
}

export interface ResumoPorChave {
  chave: string;
  productId: string;
  name: string;
  qtd: Prisma.Decimal;
  receita: Prisma.Decimal;
  custo: Prisma.Decimal;
  lucro: Prisma.Decimal;
}

/**
 * Agrupa linhas vendidas por uma chave (id do produto no painel, nome nos
 * relatórios). Receita e custo arredondados a centavos só no fim; o lucro sai
 * de {@link FinancialCalc.lucroBruto}.
 */
export function resumirPor(
  linhas: LinhaVendida[],
  chaveDe: (l: LinhaVendida) => string,
): ResumoPorChave[] {
  const grupos = new Map<string, LinhaVendida[]>();
  for (const l of linhas) {
    const k = chaveDe(l);
    const g = grupos.get(k);
    if (g) g.push(l);
    else grupos.set(k, [l]);
  }
  return [...grupos.entries()].map(([chave, g]) => {
    const receita = money(add(...g.map((l) => l.receita)));
    const custo = money(add(...g.map((l) => l.custo)));
    return {
      chave,
      productId: g[0]!.productId,
      name: g[0]!.productName,
      qtd: add(...g.map((l) => l.quantity)),
      receita,
      custo,
      lucro: FinancialCalc.lucroBruto(receita, custo),
    };
  });
}
