import { Prisma } from "@prisma/client";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { audit } from "@/lib/audit";
import { FinancialCalc } from "./financial-calc.service";
import { add, gt, sub, money, toDecimal } from "@/lib/money";
import { NotFoundError, BusinessRuleError } from "@/lib/http/app-error";
import type {
  HigienizacaoInput,
  HigienizacaoDevolucaoInput,
  HigienizacaoPagamentoInput,
} from "@/lib/validations/higienizacao";
import type { TenantCtx } from "@/lib/http/with-action";
import type { CrateCleaningStatus } from "@prisma/client";

function computeCleaningStatus(c: {
  sentQty: number;
  returnedQty: number;
  totalAmount: Prisma.Decimal | number;
  paidAmount: Prisma.Decimal | number;
}): CrateCleaningStatus {
  if (!gt(c.totalAmount, c.paidAmount)) return "PAGO"; // pago >= total
  if (c.returnedQty >= c.sentQty) return "DEVOLVIDO";
  return "ENVIADO";
}

export const HigienizacaoService = {
  async list(tenantId: string) {
    const db = getTenantPrisma(tenantId);
    const registros = await db.crateCleaning.findMany({
      orderBy: { sentDate: "desc" },
      take: 100,
    });
    // Totais derivados (§8.8): caixas a receber e financeiro a pagar.
    const caixasAReceber = registros.reduce(
      (a, c) => a + Math.max(0, c.sentQty - c.returnedQty),
      0,
    );
    const totalAPagar = money(
      add(...registros.map((c) => sub(c.totalAmount, c.paidAmount))),
    );
    return { registros, caixasAReceber, totalAPagar };
  },

  async get(tenantId: string, id: string) {
    const db = getTenantPrisma(tenantId);
    const c = await db.crateCleaning.findFirst({ where: { id } });
    if (!c) throw new NotFoundError("Registro de higienização não encontrado");
    return {
      ...c,
      caixasAReceber: Math.max(0, c.sentQty - c.returnedQty),
      valorAPagar: money(sub(c.totalAmount, c.paidAmount)),
    };
  },

  async create(input: HigienizacaoInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const totalAmount = FinancialCalc.valorTotalVenda(input.sentQty, input.unitPrice);
    const c = await db.crateCleaning.create({
      data: {
        tenantId: ctx.tenantId,
        cleanerName: input.cleanerName,
        sentDate: new Date(input.sentDate),
        sentQty: input.sentQty,
        unitPrice: input.unitPrice,
        totalAmount,
        notes: input.notes ?? null,
      },
    });
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "CREATE",
      entity: "CrateCleaning",
      entityId: c.id,
      newData: { cleanerName: c.cleanerName, sentQty: c.sentQty, totalAmount: totalAmount.toString() },
      ip: ctx.ip,
    });
    return c;
  },

  async registrarDevolucao(input: HigienizacaoDevolucaoInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    return db.$transaction(async (tx) => {
      const c = await tx.crateCleaning.findFirst({ where: { id: input.id } });
      if (!c) throw new NotFoundError("Registro não encontrado");
      const novoDevolvido = c.returnedQty + input.quantity;
      if (novoDevolvido > c.sentQty) {
        throw new BusinessRuleError(
          `Faltam apenas ${c.sentQty - c.returnedQty} caixa(s) para devolver.`,
        );
      }
      const status = computeCleaningStatus({ ...c, returnedQty: novoDevolvido });
      const updated = await tx.crateCleaning.update({
        where: { id: c.id },
        data: { returnedQty: novoDevolvido, returnedDate: new Date(input.returnedDate), status },
      });
      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "UPDATE",
          entity: "CrateCleaning",
          entityId: c.id,
          oldData: { returnedQty: c.returnedQty },
          newData: { returnedQty: novoDevolvido, status },
          ip: ctx.ip,
        },
        tx,
      );
      return updated;
    });
  },

  async registrarPagamento(input: HigienizacaoPagamentoInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    return db.$transaction(async (tx) => {
      const c = await tx.crateCleaning.findFirst({ where: { id: input.id } });
      if (!c) throw new NotFoundError("Registro não encontrado");
      const saldo = sub(c.totalAmount, c.paidAmount);
      if (gt(input.amount, saldo)) {
        throw new BusinessRuleError(`O valor é maior que o saldo a pagar (${saldo.toString()}).`);
      }
      const novoPago = money(add(c.paidAmount, input.amount));
      const status = computeCleaningStatus({ ...c, paidAmount: novoPago });
      const updated = await tx.crateCleaning.update({
        where: { id: c.id },
        data: { paidAmount: novoPago, paidDate: new Date(input.paidDate), status },
      });
      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "PAYMENT",
          entity: "CrateCleaning",
          entityId: c.id,
          oldData: { paidAmount: c.paidAmount.toString() },
          newData: { paidAmount: novoPago.toString(), status },
          ip: ctx.ip,
        },
        tx,
      );
      return updated;
    });
  },

  async remove(id: string, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const before = await db.crateCleaning.findFirst({ where: { id } });
    if (!before) throw new NotFoundError("Registro não encontrado");
    if (!toDecimal(before.paidAmount).isZero()) {
      throw new BusinessRuleError("Não é possível excluir um registro com pagamentos.");
    }
    await db.crateCleaning.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "DELETE",
      entity: "CrateCleaning",
      entityId: id,
      oldData: before,
      ip: ctx.ip,
    });
  },
};
