import { Prisma } from "@prisma/client";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { audit } from "@/lib/audit";
import { add, mul, money, toDecimal, gt } from "@/lib/money";
import { BusinessRuleError, NotFoundError } from "@/lib/http/app-error";
import { CaixasService } from "./caixas.service";
import type { VendaInput } from "@/lib/validations/venda";
import type { TenantCtx } from "@/lib/http/with-action";

const IN_TYPES = new Set(["ENTRADA", "AJUSTE"]);

/** Caixas plásticas da venda: valor informado ou soma dos itens em caixa plástica. */
export function resolvePlasticCrateQty(input: VendaInput): number {
  if (input.plasticCrateQty !== undefined) return input.plasticCrateQty;
  return input.items.reduce(
    (total, i) => total + (i.recipientType === "PLASTICA" ? (i.crateQty ?? 0) : 0),
    0,
  );
}

export const VendasService = {
  async list(tenantId: string) {
    const db = getTenantPrisma(tenantId);
    return db.sale.findMany({
      include: { items: { include: { product: true } }, creditAccount: true },
      orderBy: { saleDate: "desc" },
      take: 100,
    });
  },

  async registrarVenda(input: VendaInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const productIds = [...new Set(input.items.map((i) => i.productId))];
    const saleDate = input.saleDate ? new Date(input.saleDate) : new Date();
    const plasticCrateQty = resolvePlasticCrateQty(input);
    // Saldo lido fora da transação (igual ao fluxo de CaixasService.registrar).
    const crateSaldo =
      plasticCrateQty > 0 ? await CaixasService.getSaldo(ctx.tenantId) : null;

    return db.$transaction(async (tx) => {
      const products = await tx.product.findMany({
        where: { id: { in: productIds }, active: true },
        select: { id: true },
      });
      if (products.length !== productIds.length) {
        throw new NotFoundError("Um ou mais produtos nao foram encontrados");
      }

      // 1. Saldo atual por produto + custo médio (custo dos produtos que entraram)
      const [grouped, costs] = await Promise.all([
        tx.stockMovement.groupBy({
          by: ["productId", "type"],
          where: { productId: { in: productIds } },
          _sum: { quantity: true },
        }),
        tx.stockMovement.groupBy({
          by: ["productId"],
          where: { productId: { in: productIds }, type: "ENTRADA" },
          _avg: { unitCost: true },
        }),
      ]);

      const available = new Map<string, Prisma.Decimal>();
      for (const g of grouped) {
        const signed = IN_TYPES.has(g.type)
          ? toDecimal(g._sum.quantity ?? 0)
          : toDecimal(g._sum.quantity ?? 0).negated();
        available.set(
          g.productId,
          (available.get(g.productId) ?? new Prisma.Decimal(0)).plus(signed),
        );
      }
      const costMap = new Map<string, Prisma.Decimal>();
      for (const c of costs) costMap.set(c.productId, toDecimal(c._avg.unitCost ?? 0));

      // 2. Valida disponibilidade (quantidade pedida por produto)
      const requested = new Map<string, Prisma.Decimal>();
      for (const it of input.items) {
        requested.set(
          it.productId,
          (requested.get(it.productId) ?? new Prisma.Decimal(0)).plus(toDecimal(it.quantity)),
        );
      }
      for (const [pid, qty] of requested) {
        const avail = available.get(pid) ?? new Prisma.Decimal(0);
        if (gt(qty, avail)) {
          const prod = await tx.product.findFirst({ where: { id: pid } });
          throw new BusinessRuleError(
            `Estoque insuficiente de ${prod?.name ?? "produto"} (disponível: ${avail.toString()}).`,
          );
        }
      }

      // 3. Cria a venda + itens
      const lineTotals = input.items.map((i) => mul(i.quantity, i.unitPrice));
      const totalAmount = money(add(...lineTotals));
      const sale = await tx.sale.create({
        data: {
          tenantId: ctx.tenantId,
          customerName: input.customerName || null,
          saleDate,
          paymentMethod: input.paymentMethod,
          totalAmount,
          plasticCrateQty,
          items: {
            create: input.items.map((i, idx) => ({
              tenantId: ctx.tenantId,
              productId: i.productId,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              recipientType: i.recipientType ?? null,
              crateQty: i.crateQty ?? 0,
              lineTotal: money(lineTotals[idx]),
              unitCostAtSale: costMap.get(i.productId) ?? new Prisma.Decimal(0),
            })),
          },
        },
        include: { items: true },
      });

      // 4. Baixa de estoque (SAIDA por item)
      await tx.stockMovement.createMany({
        data: sale.items.map((it) => ({
          tenantId: ctx.tenantId,
          productId: it.productId,
          type: "SAIDA" as const,
          quantity: it.quantity,
          unitCost: it.unitCostAtSale,
          sourceType: "SALE",
          sourceId: sale.id,
        })),
      });

      // 5. Caixas plásticas que saíram com a mercadoria (livro-razão de caixas)
      if (plasticCrateQty > 0 && crateSaldo) {
        await CaixasService.registrarInTx(
          tx,
          {
            type: "SAIDA",
            quantity: plasticCrateQty,
            customerName: input.customerName!,
            movementDate: saleDate.toISOString(),
            saleId: sale.id,
            notes: "Saída automática pela venda",
          },
          ctx,
          crateSaldo,
        );
      }

      // 6. Fiado → conta a receber
      if (input.paymentMethod === "FIADO") {
        await tx.creditAccount.create({
          data: {
            tenantId: ctx.tenantId,
            saleId: sale.id,
            customerName: input.customerName!,
            totalAmount,
            paidAmount: new Prisma.Decimal(0),
            status: "EM_ABERTO",
            dueDate: input.dueDate ? new Date(input.dueDate) : null,
          },
        });
      }

      // 7. Auditoria
      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "CREATE",
          entity: "Sale",
          entityId: sale.id,
          newData: {
            totalAmount: totalAmount.toString(),
            paymentMethod: sale.paymentMethod,
            items: sale.items.length,
            plasticCrateQty,
          },
          ip: ctx.ip,
        },
        tx,
      );

      return sale;
    });
  },
};
