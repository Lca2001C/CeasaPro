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
import { parseFormDateTz, startOfDayTz } from "@/lib/tz";

const SALE_INCLUDE = {
  items: { include: { product: true }, orderBy: { createdAt: "asc" } },
  payments: { select: { method: true, amount: true } },
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

/**
 * Quantas contas cada página das abas "Pagas" e "Todas" mostra.
 *
 * Essas duas abas crescem para sempre — toda venda a prazo quitada fica nelas —
 * e eram carregadas inteiras, com os itens de cada venda, em ordem crescente:
 * com um ano de balcão a tela trazia milhares de linhas e abria na MAIS ANTIGA.
 * "Em aberto" continua sem página: é a lista de cobrança, e dívida em aberto
 * não pode ficar escondida na página 2.
 */
export const FIADO_POR_PAGINA = 50;

export const FiadoService = {
  /**
   * Contas com saldo calculado + total geral a receber.
   *
   * `EM_ABERTO` (o padrão) mantém o comportamento original: todas as contas,
   * da mais antiga para a mais nova. `PAGO` e `TODAS` são paginadas
   * ({@link FIADO_POR_PAGINA}) e vêm da mais recente para a mais antiga.
   *
   * `totalGeral`, `totalCaixas` e `vencidas` são SEMPRE sobre todas as contas
   * em aberto (respeitando só a busca), nunca sobre a página: são os cartões
   * "Total a receber" e "Caixas com clientes", que falam da dívida na rua.
   */
  async listOpen(
    tenantId: string,
    status: FiadoStatusFiltro = "EM_ABERTO",
    search?: string,
    opts: { pagina?: number; agora?: Date } = {},
  ) {
    const db = getTenantPrisma(tenantId);
    const paginada = status !== "EM_ABERTO";
    const pagina = paginada ? Math.max(1, Math.floor(opts.pagina ?? 1)) : 1;
    const where = {
      ...(status === "TODAS" ? {} : { status }),
      ...(search ? { customerName: { contains: search, mode: "insensitive" as const } } : {}),
    };
    const [contas, total, caixasPorCliente] = await Promise.all([
      db.creditAccount.findMany({
        where,
        include: { sale: SALE_RESUMO },
        orderBy: paginada
          ? [{ createdAt: "desc" }, { id: "desc" }]
          : [{ createdAt: "asc" }],
        ...(paginada ? { take: FIADO_POR_PAGINA, skip: (pagina - 1) * FIADO_POR_PAGINA } : {}),
      }),
      paginada ? db.creditAccount.count({ where }) : Promise.resolve(null),
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
    // Os cartões "Total a receber" e "Caixas com clientes" falam da dívida EM
    // ABERTO, qualquer que seja a aba. Calculados sobre a lista já filtrada, a
    // aba "Pagas" mostrava R$ 0,00 e 0 caixas para uma empresa com fiado na
    // rua. Nas abas paginadas as contas abertas são lidas à parte (respeitando
    // só a busca) — a página de "Todas" tem só um pedaço delas; em "Em aberto"
    // a lista já é o conjunto inteiro.
    const emAberto = paginada
      ? (
          await db.creditAccount.findMany({
            where: {
              status: "EM_ABERTO",
              ...(search ? { customerName: { contains: search, mode: "insensitive" } } : {}),
            },
            select: { customerName: true, totalAmount: true, paidAmount: true, dueDate: true },
          })
        ).map((c) => ({
          customerName: c.customerName,
          dueDate: c.dueDate,
          saldo: FinancialCalc.saldoFiado(c.totalAmount, c.paidAmount),
        }))
      : withSaldo.filter((c) => c.status === "EM_ABERTO");
    const totalGeral = add(...emAberto.map((c) => c.saldo));
    // Vencida = vencimento antes de HOJE no fuso do app, ainda devendo.
    const hoje = startOfDayTz(opts.agora ?? new Date());
    const vencidas = emAberto.filter((c) => c.dueDate !== null && c.dueDate < hoje).length;
    // O saldo de caixas é por CLIENTE, não por conta. Cada venda fiada abre uma
    // conta nova (vendas.service.ts:607), então um cliente que compra a prazo
    // duas vezes tem duas contas em aberto — e somar linha a linha contava o
    // saldo dele uma vez por conta. O painel mostrava o dobro (ou o triplo) de
    // caixas na rua, justamente para o cliente que mais compra.
    const totalCaixas = [...new Set(emAberto.map((c) => c.customerName))].reduce(
      (a, nome) => a + (caixasPorCliente.get(nome) ?? 0),
      0,
    );
    const totalContas = total ?? withSaldo.length;
    return {
      contas: withSaldo,
      totalGeral,
      totalCaixas,
      vencidas,
      /** Quantas contas o filtro tem ao todo (não só a página). */
      total: totalContas,
      pagina,
      ultimaPagina: paginada ? Math.max(1, Math.ceil(totalContas / FIADO_POR_PAGINA)) : 1,
    };
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

    // A conta guarda só a PARTE fiada da venda. Numa venda de R$ 100 com R$ 60
    // no PIX e R$ 40 no fiado, a tela mostrava os itens somando R$ 100 e, logo
    // abaixo, "Total da compra R$ 40,00", sem nada dizendo que R$ 60 já tinham
    // sido pagos no balcão. O detalhe precisa do total da venda e do que foi
    // pago fora do fiado para fechar a conta na frente do dono.
    const pagoNoBalcao = add(
      ...(conta.sale?.payments ?? []).filter((p) => p.method !== "FIADO").map((p) => p.amount),
    );

    return {
      ...conta,
      totalDaVenda: conta.sale?.totalAmount ?? conta.totalAmount,
      descontoDaVenda: conta.sale?.discountAmount ?? null,
      pagoNoBalcao,
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
   *
   * Telefone e observação vão DENTRO da transação da venda: o telefone pelo
   * próprio corpo da venda (que o grava na venda e na conta), a observação por
   * `observacaoDoFiado`. Antes os dois entravam num `update` solto depois do
   * commit, sem auditoria, e a venda ficava sem telefone no detalhe.
   *
   * A leitura da conta depois do commit não pode falhar: `gravarVenda` recusa
   * fiado de R$ 0,00 antes de gravar, e é só com total zero que a conta não
   * nascia. (Era esse o caso em que a tela respondia "conta não encontrada"
   * com a venda e a baixa de estoque já gravadas.)
   */
  async create(input: FiadoManualInput, ctx: TenantCtx) {
    const sale = await VendasService.registrarVenda(
      {
        customerName: input.customerName,
        customerPhone: input.customerPhone ?? null,
        paymentMethod: "FIADO",
        saleDate: input.saleDate,
        dueDate: input.dueDate ?? null,
        plasticCrateQty: input.plasticCrateQty,
        items: input.items,
      },
      ctx,
      { observacaoDoFiado: input.notes ?? null },
    );

    const db = getTenantPrisma(ctx.tenantId);
    const conta = await db.creditAccount.findFirst({ where: { saleId: sale.id } });
    if (!conta) throw new NotFoundError("Conta de fiado não encontrada após a venda");
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
        sale: {
          select: {
            id: true,
            customerName: true,
            plasticCrateQty: true,
            items: true,
            payments: { select: { method: true } },
          },
        },
      },
    });
    if (!conta) throw new NotFoundError("Conta de fiado não encontrada");

    const recusaPagamento = () =>
      new BusinessRuleError(
        "Esta conta já tem pagamento registrado e não pode ser excluída — " +
          "apagá-la sumiria com dinheiro que entrou no caixa.",
      );
    if (conta.payments.length > 0 || gt(conta.paidAmount, 0)) throw recusaPagamento();

    // Venda MISTA (parte no PIX/dinheiro/cartão, parte no fiado): excluir o
    // fiado desfaz a venda inteira, e o que foi pago no balcão sumia do fluxo
    // de caixa — que só conta venda não excluída. É o mesmo "sumir com dinheiro
    // que entrou" da regra acima, por outra porta.
    if (conta.sale?.payments.some((p) => p.method !== "FIADO")) {
      throw new BusinessRuleError(
        "Parte desta venda foi paga no balcão (PIX, dinheiro ou cartão). " +
          "Excluir o fiado apagaria esse recebimento — cancele a venda pelo histórico de vendas.",
      );
    }

    const crateQty = conta.sale?.plasticCrateQty ?? 0;
    const agora = new Date();
    // Decidido dentro da transação (depende do saldo do cliente sob lock).
    let caixasEstornadas = 0;

    await db.$transaction(async (tx) => {
      // A checagem de pagamento acima roda FORA da transação: um pagamento que
      // entrasse entre ela e aqui seria apagado junto. O filtro `paidAmount: 0`
      // refaz a checagem de forma atômica, na própria escrita.
      const { count } = await tx.creditAccount.updateMany({
        where: { id: conta.id, paidAmount: 0 },
        data: { deletedAt: agora },
      });
      if (count !== 1) throw recusaPagamento();

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

        // Caixas: apagar a SAIDA só desfaz a venda se as caixas AINDA estão
        // com o cliente. O RETORNO é lançado por nome de cliente, sem vínculo
        // com a venda — então, se ele já devolveu, apagar a SAIDA deixava o
        // RETORNO sem contrapartida: `comClientes` ficava negativo e as
        // devolvidas continuavam contadas como sujas (voltavam duas vezes).
        //
        // Decidido DENTRO da transação, depois do lock de caixas, pelo saldo
        // DO CLIENTE — o mesmo critério de `VendasService.cancelarVenda`.
        const cliente = conta.sale.customerName ?? conta.customerName;
        if (crateQty > 0) {
          const saldo = await CaixasService.getSaldoInTx(tx, ctx.tenantId);
          const doCliente = await CaixasService.saldoDoClienteInTx(tx, ctx.tenantId, cliente);
          caixasEstornadas = Math.min(
            crateQty,
            Math.max(0, doCliente),
            Math.max(0, saldo.comClientes),
          );
        }

        if (caixasEstornadas === crateQty) {
          // Tudo ainda está com o cliente (ou a venda não levou caixa): a
          // reversão exata é apagar o movimento, como se a venda não tivesse
          // existido — as caixas voltam para `limpas`.
          await tx.plasticCrateMovement.deleteMany({
            where: { tenantId: ctx.tenantId, saleId: conta.sale.id },
          });
        } else if (caixasEstornadas > 0) {
          // Parte já voltou: a SAIDA fica (ela aconteceu, e o RETORNO lançado
          // depende dela) e só o que o cliente ainda tem é estornado. O
          // ESTORNO_SAIDA devolve essas caixas para `limpas`, como o
          // cancelamento de venda faz.
          await CaixasService.registrarInTx(
            tx,
            {
              type: "ESTORNO_SAIDA",
              quantity: caixasEstornadas,
              customerName: cliente,
              movementDate: agora.toISOString(),
              saleId: conta.sale.id,
              notes: "Estorno pela exclusão do fiado",
            },
            ctx,
          );
        }
        // caixasEstornadas === 0 com caixas na venda: o cliente já devolveu
        // todas. Nada a desfazer — a SAIDA e o RETORNO continuam se anulando.

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
            caixasDevolvidas: caixasEstornadas,
            caixasNaoEstornadas: crateQty - caixasEstornadas,
            vendaExcluida: Boolean(conta.sale),
          },
          ip: ctx.ip,
        },
        tx,
      );
    });

    return {
      id: conta.id,
      customerName: conta.customerName,
      caixasEstornadas,
      /** Caixas da venda que o cliente já tinha devolvido — não voltam de novo. */
      caixasNaoEstornadas: crateQty - caixasEstornadas,
    };
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
