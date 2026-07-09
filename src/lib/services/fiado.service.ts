import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { audit } from "@/lib/audit";
import { FinancialCalc } from "./financial-calc.service";
import { add, gt } from "@/lib/money";
import { NotFoundError, BusinessRuleError } from "@/lib/http/app-error";
import type { PagamentoFiadoInput } from "@/lib/validations/fiado";
import type { TenantCtx } from "@/lib/http/with-action";

export const FiadoService = {
  /** Contas em aberto com saldo calculado + total geral a receber. */
  async listOpen(tenantId: string) {
    const db = getTenantPrisma(tenantId);
    const contas = await db.creditAccount.findMany({
      where: { status: "EM_ABERTO" },
      orderBy: { createdAt: "asc" },
    });
    const withSaldo = contas.map((c) => ({
      ...c,
      saldo: FinancialCalc.saldoFiado(c.totalAmount, c.paidAmount),
    }));
    const totalGeral = add(...withSaldo.map((c) => c.saldo));
    return { contas: withSaldo, totalGeral };
  },

  async get(tenantId: string, id: string) {
    const db = getTenantPrisma(tenantId);
    const conta = await db.creditAccount.findFirst({
      where: { id },
      include: { payments: { orderBy: { paidAt: "desc" } }, sale: true },
    });
    if (!conta) throw new NotFoundError("Conta de fiado não encontrada");
    return { ...conta, saldo: FinancialCalc.saldoFiado(conta.totalAmount, conta.paidAmount) };
  },

  async registrarPagamento(input: PagamentoFiadoInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    return db.$transaction(async (tx) => {
      const conta = await tx.creditAccount.findFirst({ where: { id: input.accountId } });
      if (!conta) throw new NotFoundError("Conta de fiado não encontrada");

      const saldo = FinancialCalc.saldoFiado(conta.totalAmount, conta.paidAmount);
      if (gt(input.amount, saldo)) {
        throw new BusinessRuleError(
          `O valor é maior que o saldo devedor (${saldo.toString()}).`,
        );
      }

      await tx.creditPayment.create({
        data: {
          tenantId: ctx.tenantId,
          accountId: conta.id,
          amount: input.amount,
          method: input.method,
        },
      });

      const novoPago = add(conta.paidAmount, input.amount);
      const quitado = !gt(conta.totalAmount, novoPago); // total <= pago
      const updated = await tx.creditAccount.update({
        where: { id: conta.id },
        data: {
          paidAmount: novoPago,
          status: quitado ? "PAGO" : "EM_ABERTO",
        },
      });

      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "PAYMENT",
          entity: "CreditAccount",
          entityId: conta.id,
          oldData: { paidAmount: conta.paidAmount.toString() },
          newData: { paidAmount: novoPago.toString(), status: updated.status },
          ip: ctx.ip,
        },
        tx,
      );

      return updated;
    });
  },
};
