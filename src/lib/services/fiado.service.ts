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
import { parseFormDateTz } from "@/lib/tz";

const SALE_INCLUDE = {
  items: { include: { product: true }, orderBy: { createdAt: "asc" } },
} as const;

/**
 * O que a LISTA precisa saber da venda para montar a linha de entrega — data,
 * produto, quantidade e preço — no mesmo formato da planilha que o cliente usa
 * no balcão. Antes a listagem só trazia `saleDate` e `plasticCrateQty`, então
 * era preciso abrir cada conta para saber o que tinha sido vendido.
 */
const SALE_RESUMO = {
  select: {
    saleDate: true,
    plasticCrateQty: true,
    items: {
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        quantity: true,
        unitPrice: true,
        lineTotal: true,
        crateQty: true,
        product: { select: { name: true, saleUnit: true } },
      },
    },
  },
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
        include: { sale: SALE_RESUMO },
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
      itens: (c.sale?.items ?? []).map((it) => ({
        id: it.id,
        productName: it.product.name,
        saleUnit: it.product.saleUnit,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        lineTotal: it.lineTotal,
        crateQty: it.crateQty,
      })),
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
        dueDate: input.dueDate ? parseFormDateTz(input.dueDate) : null,
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

  /**
   * Exclui um lançamento de fiado — e **desfaz a venda que o originou**.
   *
   * Apagar só a conta deixaria a venda de pé: o faturamento continuaria
   * contando, a mercadoria seguiria baixada do estoque e o valor sumiria do "a
   * receber". Ou seja, o sistema fecharia com um buraco. Por isso a exclusão
   * reverte a operação inteira, na mesma transação: conta, venda, baixa de
   * estoque e caixas plásticas que saíram com a mercadoria — que voltam
   * exatamente ao estado anterior à venda.
   *
   * **Recusa quando já houve pagamento.** Apagar dinheiro que entrou é falsear
   * o caixa; nesse caso o caminho é acertar o valor com o cliente, não excluir
   * o registro. É a mesma lógica que impede pagar acima do saldo.
   */
  async remove(id: string, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const conta = await db.creditAccount.findFirst({
      where: { id },
      include: {
        payments: { select: { id: true } },
        sale: { select: { id: true, plasticCrateQty: true, items: true } },
      },
    });
    if (!conta) throw new NotFoundError("Conta de fiado não encontrada");

    if (conta.payments.length > 0 || gt(conta.paidAmount, 0)) {
      throw new BusinessRuleError(
        "Esta conta já tem pagamento registrado e não pode ser excluída — " +
          "apagá-la sumiria com dinheiro que entrou no caixa.",
      );
    }

    const crateQty = conta.sale?.plasticCrateQty ?? 0;
    const agora = new Date();

    await db.$transaction(async (tx) => {
      await tx.creditAccount.update({
        where: { id: conta.id },
        data: { deletedAt: agora },
      });

      if (conta.sale) {
        // Os movimentos de estoque e de caixas são APAGADOS, não compensados.
        //
        // Compensar seria o certo se a venda tivesse acontecido e fosse
        // devolvida — mas aqui ela está sendo desfeita, como se não tivesse
        // existido. Uma ENTRADA de estorno apareceria no histórico do produto
        // como se mercadoria tivesse chegado, e nas caixas nem funcionaria:
        // `limpas` é `entrada_limpa + retorno_hig − saida − quebra_limpa`, ou
        // seja, um RETORNO devolve a caixa para `sujas`, não para `limpas` —
        // o sistema mandaria higienizar caixa que nunca saiu do box.
        //
        // Os dois carregam o vínculo com a venda (`sourceId` / `saleId`), então
        // a remoção é exata. O que aconteceu fica registrado na auditoria e na
        // própria venda, que é preservada com `deletedAt`.
        await tx.stockMovement.deleteMany({
          where: { tenantId: ctx.tenantId, sourceType: "SALE", sourceId: conta.sale.id },
        });
        await tx.plasticCrateMovement.deleteMany({
          where: { tenantId: ctx.tenantId, saleId: conta.sale.id },
        });

        await tx.sale.update({
          where: { id: conta.sale.id },
          data: { deletedAt: agora },
        });
      }

      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "DELETE",
          entity: "CreditAccount",
          entityId: conta.id,
          oldData: {
            customerName: conta.customerName,
            totalAmount: conta.totalAmount.toString(),
            saleId: conta.saleId,
          },
          newData: {
            itensDevolvidosAoEstoque: conta.sale?.items.length ?? 0,
            caixasDevolvidas: crateQty,
            vendaExcluida: Boolean(conta.sale),
          },
          ip: ctx.ip,
        },
        tx,
      );
    });

    return { id: conta.id, customerName: conta.customerName };
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
      const status = quitado ? "PAGO" : "EM_ABERTO";

      // O `paidAmount` lido acima entra na condição do UPDATE. Sem isso era
      // leitura-soma-escrita comum: em READ COMMITTED (o padrão do Postgres),
      // dois pagamentos simultâneos leem o mesmo saldo e o segundo grava o total
      // dele por cima do primeiro. Ficavam dois `CreditPayment` no extrato e só
      // um valor somado na conta — dinheiro recebido que continuava aparecendo
      // como dívida do cliente. Acontece com o dono e o funcionário lançando ao
      // mesmo tempo, ou com um duplo toque no botão em rede ruim.
      //
      // O Postgres reavalia o WHERE depois de esperar o lock da linha, então o
      // segundo não casa e é recusado — em dinheiro, recusar e avisar é melhor
      // que somar errado em silêncio. Mesmo padrão de `applyPaymentStatus`.
      const escrito = await tx.creditAccount.updateMany({
        where: { id: conta.id, paidAmount: conta.paidAmount },
        data: { paidAmount: novoPago, status },
      });
      if (escrito.count !== 1) {
        throw new BusinessRuleError(
          "Outro pagamento desta conta foi registrado agora mesmo. " +
            "Confira o saldo e lance de novo.",
        );
      }

      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "PAYMENT",
          entity: "CreditAccount",
          entityId: conta.id,
          oldData: { paidAmount: conta.paidAmount.toString() },
          newData: { paidAmount: novoPago.toString(), status },
          ip: ctx.ip,
        },
        tx,
      );

      // Relê depois da guarda: o registro devolvido é o que ficou gravado.
      return tx.creditAccount.findFirstOrThrow({ where: { id: conta.id } });
    });
  },
};
