import type { Prisma } from "@prisma/client";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit";
import { FinancialCalc } from "./financial-calc.service";
import { add, mul, money } from "@/lib/money";
import { BusinessRuleError, NotFoundError } from "@/lib/http/app-error";
import { CaixasService } from "./caixas.service";
import { DespesasService } from "./despesas.service";
import type { CompraInput } from "@/lib/validations/compra";
import type { TenantCtx } from "@/lib/http/with-action";
import { parseFormDateTz } from "@/lib/tz";

export const ComprasService = {
  async list(tenantId: string) {
    const db = getTenantPrisma(tenantId);
    return db.purchase.findMany({
      // O produto vem junto para a lista poder abrir os itens sem outra
      // consulta — conferir "o que veio nesta compra" era o buraco da tela.
      include: {
        supplier: true,
        items: { include: { product: { select: { name: true } } } },
      },
      orderBy: { purchaseDate: "desc" },
      take: 100,
    });
  },

  /**
   * O último preço PAGO por produto, para a tela de compra lembrar por ela.
   *
   * Devolve `unitPrice`, e não `unitCost`, e a diferença é o ponto todo: o
   * `unitCost` já inclui o rateio do frete (`custoRealUnitario`), então é o preço
   * negociado MAIS o caminhão do comprador. Exibir isso ao lado do preço que ele
   * está digitando — e ao lado do boletim, que é preço na praça, antes de
   * qualquer transporte — faria toda comparação apontar "você pagou acima", todo
   * dia, para todo mundo. O viés seria constante e invisível.
   *
   * `DISTINCT ON` no molde de `VendasService.precosSugeridosDaCompra`. O `JOIN`
   * com `purchases` é obrigatório: `purchase_items` não tem `deletedAt` próprio,
   * então sem ele uma compra excluída continuaria ditando o "último preço".
   */
  async ultimosPrecosPagos(
    tenantId: string,
  ): Promise<Record<string, { unitPrice: number; purchaseDate: Date }>> {
    const rows = await prisma.$queryRaw<
      { productId: string; unitPrice: Prisma.Decimal; purchaseDate: Date }[]
    >`
      SELECT DISTINCT ON (pi."productId")
             pi."productId", pi."unitPrice", p."purchaseDate"
      FROM purchase_items pi
      JOIN purchases p ON p.id = pi."purchaseId"
      WHERE pi."tenantId" = ${tenantId} AND p."deletedAt" IS NULL
      ORDER BY pi."productId", p."purchaseDate" DESC, pi."createdAt" DESC
    `;
    const mapa: Record<string, { unitPrice: number; purchaseDate: Date }> = {};
    for (const r of rows) {
      const valor = Number(money(r.unitPrice));
      if (valor > 0) mapa[r.productId] = { unitPrice: valor, purchaseDate: r.purchaseDate };
    }
    return mapa;
  },

  async registrarCompra(input: CompraInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const productIds = [...new Set(input.items.map((i) => i.productId))];

    const caixasRecebidas = input.caixasRecebidas ?? 0;
    const caixasQuebradas = input.caixasQuebradas ?? 0;
    if (caixasQuebradas > caixasRecebidas) {
      throw new BusinessRuleError(
        "As caixas quebradas não podem passar do total de caixas recebidas.",
      );
    }
    // Saldo lido FORA da transação, como em `registrarVenda`: `registrarInTx`
    // valida o movimento contra ele e não pode reabrir conexão no meio.
    const fornecedorNome = input.supplierId
      ? ((await db.supplier.findFirst({
          where: { id: input.supplierId },
          select: { name: true },
        }))?.name ?? null)
      : null;

    const lineTotals = input.items.map((i) => mul(i.quantity, i.unitPrice));
    const freightShares = FinancialCalc.ratearFrete(lineTotals, input.freight);
    const totalAmount = money(add(...lineTotals, input.freight));

    const itemsData = input.items.map((i, idx) => ({
      tenantId: ctx.tenantId,
      productId: i.productId,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      recipientType: i.recipientType ?? null,
      freightShare: freightShares[idx],
      unitCost: FinancialCalc.custoRealUnitario(i.quantity, i.unitPrice, freightShares[idx]),
      lineTotal: money(lineTotals[idx]),
      suggestedSalePrice: i.suggestedSalePrice ?? null,
    }));

    return db.$transaction(async (tx) => {
      if (input.supplierId) {
        const supplier = await tx.supplier.findFirst({
          where: { id: input.supplierId, active: true },
          select: { id: true },
        });
        if (!supplier) throw new NotFoundError("Fornecedor nao encontrado");
      }

      const products = await tx.product.findMany({
        where: { id: { in: productIds }, active: true },
        select: { id: true },
      });
      if (products.length !== productIds.length) {
        throw new NotFoundError("Um ou mais produtos nao foram encontrados");
      }

      const purchase = await tx.purchase.create({
        data: {
          tenantId: ctx.tenantId,
          supplierId: input.supplierId || null,
          purchaseDate: parseFormDateTz(input.purchaseDate),
          freight: input.freight,
          totalAmount,
          notes: input.notes ?? null,
          items: { create: itemsData },
        },
        include: { items: true },
      });

      await tx.stockMovement.createMany({
        data: purchase.items.map((it) => ({
          tenantId: ctx.tenantId,
          productId: it.productId,
          type: "ENTRADA" as const,
          quantity: it.quantity,
          unitCost: it.unitCost,
          sourceType: "PURCHASE",
          sourceId: purchase.id,
          movedAt: purchase.purchaseDate,
        })),
      });

      // Caixas plásticas que vieram com a mercadoria, na MESMA transação.
      // Antes era um segundo lançamento em outra tela — e a metade esquecida
      // fazia o saldo de caixas divergir do que existe no box.
      if (caixasRecebidas > 0) {
        await CaixasService.registrarInTx(
          tx,
          {
            type: "ENTRADA",
            quantity: caixasRecebidas,
            brokenQty: caixasQuebradas,
            dirty: input.caixasSujas ?? false,
            supplierName: fornecedorNome,
            movementDate: purchase.purchaseDate.toISOString(),
            notes: "Entrada automática pela compra",
          },
          ctx,

        );
      }

      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "CREATE",
          entity: "Purchase",
          entityId: purchase.id,
          newData: { totalAmount: totalAmount.toString(), items: purchase.items.length },
          ip: ctx.ip,
        },
        tx,
      );

      return purchase;
    });
  },
};

/**
 * Compra + frete lançado como despesa operacional.
 *
 * A despesa fica FORA da transação da compra de propósito: a compra é o fato
 * principal (estoque, custo, caixas) e não pode ser desfeita porque o
 * lançamento do frete falhou. O vínculo `purchaseId` garante uma despesa por
 * compra, então repetir a operação não duplica o frete.
 */
export async function registrarCompraComFrete(input: CompraInput, ctx: TenantCtx) {
  const purchase = await ComprasService.registrarCompra(input, ctx);

  if (input.lancarFreteComoDespesa) {
    const fornecedor = purchase.supplierId
      ? await getTenantPrisma(ctx.tenantId).supplier.findFirst({
          where: { id: purchase.supplierId },
          select: { name: true },
        })
      : null;
    await DespesasService.lancarFreteDaCompra(
      {
        purchaseId: purchase.id,
        amount: purchase.freight,
        purchaseDate: purchase.purchaseDate,
        supplierName: fornecedor?.name ?? null,
      },
      ctx,
    );
  }

  return purchase;
}
