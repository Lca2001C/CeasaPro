import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { audit } from "@/lib/audit";
import { FinancialCalc } from "./financial-calc.service";
import { CaixasService } from "./caixas.service";
import { VendasService } from "./vendas.service";
import { add, gt } from "@/lib/money";
import { NotFoundError, BusinessRuleError } from "@/lib/http/app-error";
import type {
  PagamentoFiadoInput,
  FiadoManualInput,
  FiadoUpdateInput,
  DevolucaoCaixasInput,
  FiadoStatusFiltro,
} from "@/lib/validations/fiado";
import type { TenantCtx } from "@/lib/http/with-action";

const SALE_INCLUDE = {
  items: { include: { product: true }, orderBy: { createdAt: "asc" } },
} as const;

export const FiadoService = {
  /**
   * Contas com saldo calculado + total geral a receber.
   * O default (`EM_ABERTO`) mantém o comportamento original da listagem.
   */
  async listOpen(tenantId: string, status: FiadoStatusFiltro = "EM_ABERTO", search?: string) {
    const db = getTenantPrisma(tenantId);
    const [contas, caixasPorCliente] = await Promise.all([
      db.creditAccount.findMany({
        where: {
          ...(status === "TODAS" ? {} : { status }),
          ...(search ? { customerName: { contains: search, mode: "insensitive" } } : {}),
        },
        include: { sale: { select: { saleDate: true, plasticCrateQty: true } } },
        orderBy: { createdAt: "asc" },
      }),
      CaixasService.saldoPorCliente(tenantId),
    ]);
    const withSaldo = contas.map((c) => ({
      ...c,
      saldo: FinancialCalc.saldoFiado(c.totalAmount, c.paidAmount),
      saleDate: c.sale?.saleDate ?? c.createdAt,
      plasticCrateQty: c.sale?.plasticCrateQty ?? 0,
      caixasComCliente: caixasPorCliente.get(c.customerName) ?? 0,
    }));
    const emAberto = withSaldo.filter((c) => c.status === "EM_ABERTO");
    const totalGeral = add(...emAberto.map((c) => c.saldo));
    const totalCaixas = emAberto.reduce((a, c) => a + c.caixasComCliente, 0);
    return { contas: withSaldo, totalGeral, totalCaixas };
  },

  async get(tenantId: string, id: string) {
    const db = getTenantPrisma(tenantId);
    const conta = await db.creditAccount.findFirst({
      where: { id },
      include: {
        payments: { orderBy: { paidAt: "desc" } },
        sale: { include: SALE_INCLUDE },
      },
    });
    if (!conta) throw new NotFoundError("Conta de fiado não encontrada");

    const caixasPorCliente = await CaixasService.saldoPorCliente(tenantId);
    const itens = (conta.sale?.items ?? []).map((it) => ({
      id: it.id,
      productName: it.product.name,
      saleUnit: it.product.saleUnit,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      lineTotal: it.lineTotal,
      recipientType: it.recipientType,
      crateQty: it.crateQty,
    }));

    return {
      ...conta,
      saldo: FinancialCalc.saldoFiado(conta.totalAmount, conta.paidAmount),
      saleDate: conta.sale?.saleDate ?? conta.createdAt,
      paymentMethod: conta.sale?.paymentMethod ?? "FIADO",
      plasticCrateQty: conta.sale?.plasticCrateQty ?? 0,
      caixasComCliente: caixasPorCliente.get(conta.customerName) ?? 0,
      itens,
    };
  },

  /**
   * Lançamento manual de venda fiada. Delega para VendasService.registrarVenda
   * para reaproveitar baixa de estoque, CMV, caixas plásticas e auditoria.
   */
  async create(input: FiadoManualInput, ctx: TenantCtx) {
    const sale = await VendasService.registrarVenda(
      {
        customerName: input.customerName,
        paymentMethod: "FIADO",
        saleDate: input.saleDate,
        dueDate: input.dueDate ?? null,
        plasticCrateQty: input.plasticCrateQty,
        items: input.items,
      },
      ctx,
    );

    const db = getTenantPrisma(ctx.tenantId);
    const conta = await db.creditAccount.findFirst({ where: { saleId: sale.id } });
    if (!conta) throw new NotFoundError("Conta de fiado não encontrada após a venda");

    if (input.customerPhone || input.notes) {
      return db.creditAccount.update({
        where: { id: conta.id },
        data: {
          customerPhone: input.customerPhone ?? null,
          notes: input.notes ?? null,
        },
      });
    }
    return conta;
  },

  /** Atualiza apenas dados cadastrais (vencimento, telefone, observação). */
  async update(input: FiadoUpdateInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const before = await db.creditAccount.findFirst({ where: { id: input.id } });
    if (!before) throw new NotFoundError("Conta de fiado não encontrada");

    const updated = await db.creditAccount.update({
      where: { id: before.id },
      data: {
        customerPhone: input.customerPhone ?? null,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        notes: input.notes ?? null,
      },
    });

    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "UPDATE",
      entity: "CreditAccount",
      entityId: before.id,
      oldData: {
        dueDate: before.dueDate,
        customerPhone: before.customerPhone,
        notes: before.notes,
      },
      newData: {
        dueDate: updated.dueDate,
        customerPhone: updated.customerPhone,
        notes: updated.notes,
      },
      ip: ctx.ip,
    });
    return updated;
  },

  /** Cliente devolveu caixas plásticas — elas voltam sujas para o estoque. */
  async registrarDevolucaoCaixas(input: DevolucaoCaixasInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const conta = await db.creditAccount.findFirst({ where: { id: input.accountId } });
    if (!conta) throw new NotFoundError("Conta de fiado não encontrada");

    return CaixasService.registrar(
      {
        type: "RETORNO",
        quantity: input.quantity,
        customerName: conta.customerName,
        movementDate: input.movementDate,
        notes: input.notes ?? "Devolução registrada no fiado",
      },
      ctx,
    );
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
