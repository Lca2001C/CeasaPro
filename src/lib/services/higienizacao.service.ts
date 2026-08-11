import { Prisma } from "@prisma/client";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { audit } from "@/lib/audit";
import { FinancialCalc } from "./financial-calc.service";
import { CaixasService } from "./caixas.service";
import { add, gt, sub, money, toDecimal } from "@/lib/money";
import { NotFoundError, BusinessRuleError } from "@/lib/http/app-error";
import type {
  HigienizacaoInput,
  HigienizacaoUpdateInput,
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
  async list(tenantId: string, status?: CrateCleaningStatus) {
    const db = getTenantPrisma(tenantId);
    const [registros, saldo] = await Promise.all([
      db.crateCleaning.findMany({
        where: status ? { status } : undefined,
        orderBy: { sentDate: "desc" },
        take: 100,
      }),
      CaixasService.getSaldo(tenantId),
    ]);
    // Totais derivados (§8.8): caixas a receber e financeiro a pagar.
    const caixasAReceber = registros.reduce(
      (a, c) => a + Math.max(0, c.sentQty - c.returnedQty),
      0,
    );
    const totalAPagar = money(
      add(...registros.map((c) => sub(c.totalAmount, c.paidAmount))),
    );
    return { registros, caixasAReceber, totalAPagar, saldo };
  },

  async get(tenantId: string, id: string) {
    const db = getTenantPrisma(tenantId);
    const c = await db.crateCleaning.findFirst({ where: { id } });
    if (!c) throw new NotFoundError("Registro de higienização não encontrado");
    const movimentos = await CaixasService.listByLink(tenantId, { crateCleaningId: c.id });
    return {
      ...c,
      caixasAReceber: Math.max(0, c.sentQty - c.returnedQty),
      valorAPagar: money(sub(c.totalAmount, c.paidAmount)),
      movimentos,
    };
  },

  /** Envia caixas sujas ao higienizador — baixa do estoque de sujas (atômico). */
  async create(input: HigienizacaoInput, ctx: TenantCtx) {
    const totalAmount = FinancialCalc.valorTotalVenda(input.sentQty, input.unitPrice);
    const saldo = await CaixasService.getSaldo(ctx.tenantId);
    const db = getTenantPrisma(ctx.tenantId);

    return db.$transaction(async (tx) => {
      const c = await tx.crateCleaning.create({
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

      await CaixasService.registrarInTx(
        tx,
        {
          type: "SAIDA_HIGIENIZACAO",
          quantity: input.sentQty,
          cleanerName: input.cleanerName,
          movementDate: input.sentDate,
          crateCleaningId: c.id,
          notes: "Envio para higienização",
        },
        ctx,
        saldo,
      );

      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "CREATE",
          entity: "CrateCleaning",
          entityId: c.id,
          newData: {
            cleanerName: c.cleanerName,
            sentQty: c.sentQty,
            totalAmount: totalAmount.toString(),
          },
          ip: ctx.ip,
        },
        tx,
      );
      return c;
    });
  },

  /** Ajusta o lote antes de qualquer devolução/pagamento. */
  async update(input: HigienizacaoUpdateInput, ctx: TenantCtx) {
    const saldo = await CaixasService.getSaldo(ctx.tenantId);
    const db = getTenantPrisma(ctx.tenantId);

    return db.$transaction(async (tx) => {
      const before = await tx.crateCleaning.findFirst({ where: { id: input.id } });
      if (!before) throw new NotFoundError("Registro não encontrado");
      if (before.returnedQty > 0 || !toDecimal(before.paidAmount).isZero()) {
        throw new BusinessRuleError(
          "Este envio já teve devolução ou pagamento — não pode mais ser alterado.",
        );
      }

      const totalAmount = FinancialCalc.valorTotalVenda(input.sentQty, input.unitPrice);
      const delta = input.sentQty - before.sentQty;

      // Ajusta o livro-razão: mais caixas → nova saída; menos caixas → retorno parcial.
      if (delta > 0) {
        await CaixasService.registrarInTx(
          tx,
          {
            type: "SAIDA_HIGIENIZACAO",
            quantity: delta,
            cleanerName: input.cleanerName,
            movementDate: input.sentDate,
            crateCleaningId: before.id,
            notes: "Ajuste do envio para higienização",
          },
          ctx,
          saldo,
        );
      } else if (delta < 0) {
        await CaixasService.registrarInTx(
          tx,
          {
            type: "RETORNO_HIGIENIZACAO",
            quantity: -delta,
            cleanerName: input.cleanerName,
            movementDate: input.sentDate,
            crateCleaningId: before.id,
            notes: "Ajuste do envio para higienização",
          },
          ctx,
          saldo,
        );
      }

      const updated = await tx.crateCleaning.update({
        where: { id: before.id },
        data: {
          cleanerName: input.cleanerName,
          sentDate: new Date(input.sentDate),
          sentQty: input.sentQty,
          unitPrice: input.unitPrice,
          totalAmount,
          notes: input.notes ?? null,
        },
      });

      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "UPDATE",
          entity: "CrateCleaning",
          entityId: before.id,
          oldData: { sentQty: before.sentQty, unitPrice: before.unitPrice.toString() },
          newData: { sentQty: updated.sentQty, unitPrice: updated.unitPrice.toString() },
          ip: ctx.ip,
        },
        tx,
      );
      return updated;
    });
  },

  /** Higienizador devolveu caixas limpas — voltam ao estoque de limpas. */
  async registrarDevolucao(input: HigienizacaoDevolucaoInput, ctx: TenantCtx) {
    const saldo = await CaixasService.getSaldo(ctx.tenantId);
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

      await CaixasService.registrarInTx(
        tx,
        {
          type: "RETORNO_HIGIENIZACAO",
          quantity: input.quantity,
          cleanerName: c.cleanerName,
          movementDate: input.returnedDate,
          crateCleaningId: c.id,
          notes: "Devolução da higienização",
        },
        ctx,
        saldo,
      );

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
    const saldo = await CaixasService.getSaldo(ctx.tenantId);
    const db = getTenantPrisma(ctx.tenantId);

    await db.$transaction(async (tx) => {
      const before = await tx.crateCleaning.findFirst({ where: { id } });
      if (!before) throw new NotFoundError("Registro não encontrado");
      if (!toDecimal(before.paidAmount).isZero()) {
        throw new BusinessRuleError("Não é possível excluir um registro com pagamentos.");
      }

      // Estorna as caixas que ainda estão no higienizador (ledger é append-only).
      const pendentes = before.sentQty - before.returnedQty;
      if (pendentes > 0) {
        await CaixasService.registrarInTx(
          tx,
          {
            type: "RETORNO_HIGIENIZACAO",
            quantity: pendentes,
            cleanerName: before.cleanerName,
            movementDate: new Date().toISOString(),
            crateCleaningId: before.id,
            notes: "Estorno pela exclusão do envio",
          },
          ctx,
          saldo,
        );
      }

      await tx.crateCleaning.update({ where: { id }, data: { deletedAt: new Date() } });
      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "DELETE",
          entity: "CrateCleaning",
          entityId: id,
          oldData: before,
          ip: ctx.ip,
        },
        tx,
      );
    });
  },
};
