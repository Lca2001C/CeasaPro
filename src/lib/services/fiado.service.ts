import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { audit } from "@/lib/audit";
import { FinancialCalc } from "./financial-calc.service";
import { CaixasService, SaldoDeCaixasPorCliente } from "./caixas.service";
import { VendasService } from "./vendas.service";
import { add, gt, sub } from "@/lib/money";
import { NotFoundError, BusinessRuleError, ForbiddenError } from "@/lib/http/app-error";
import type {
  PagamentoFiadoInput,
  FiadoManualInput,
  FiadoUpdateInput,
  DevolucaoCaixasInput,
  FiadoStatusFiltro,
  EstornoRecebimentoInput,
  CancelarFiadoInput,
  BaixaPerdaInput,
  DesfazerBaixaInput,
} from "@/lib/validations/fiado";
import type { TenantCtx } from "@/lib/http/with-action";
import { parseFormDateTz } from "@/lib/tz";
import { fiadoAtrasado } from "@/lib/fiado/atraso";
import {
  dentroDoPrazoDeDesfazer,
  foraDoPrazoDeDesfazer,
  podeDesfazer,
} from "@/lib/desfazer/prazo";

/** Saldo vazio de quem não tem o módulo `caixas`: toda consulta devolve zero. */
const SEM_CAIXAS = new SaldoDeCaixasPorCliente();

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

/** O P2002 é o do índice `(tenantId, idempotencyKey)` de `credit_payments`? */
function ehConflitoDeIdempotencia(e: unknown): boolean {
  const err = e as { code?: unknown; meta?: { target?: unknown } } | null;
  if (err?.code !== "P2002") return false;
  const alvo = err.meta?.target;
  if (typeof alvo === "string") return alvo === "credit_payments_tenantId_idempotencyKey_key";
  return Array.isArray(alvo) && alvo.map(String).includes("idempotencyKey");
}

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
   *
   * `caixas: false` (empresa sem o módulo `caixas`) não lê o saldo de caixas
   * e devolve zero: quem saiu do módulo não vê o dado nem paga a consulta.
   */
  async listOpen(
    tenantId: string,
    status: FiadoStatusFiltro = "EM_ABERTO",
    search?: string,
    opts: { pagina?: number; agora?: Date; caixas?: boolean } = {},
  ) {
    const db = getTenantPrisma(tenantId);
    const paginada = status !== "EM_ABERTO";
    const pagina = paginada ? Math.max(1, Math.floor(opts.pagina ?? 1)) : 1;
    const where = {
      ...(status === "TODAS" ? {} : { status }),
      ...(search ? { customerName: { contains: search, mode: "insensitive" as const } } : {}),
    };
    // As contas abertas das abas paginadas entram no MESMO `Promise.all`: lidas
    // depois dele, eram uma rodada a mais em série a cada abertura de "Pagas".
    const [contas, total, caixasPorCliente, abertasDaBusca] = await Promise.all([
      db.creditAccount.findMany({
        where,
        include: { sale: SALE_RESUMO },
        orderBy: paginada
          ? [{ createdAt: "desc" }, { id: "desc" }]
          : [{ createdAt: "asc" }],
        ...(paginada ? { take: FIADO_POR_PAGINA, skip: (pagina - 1) * FIADO_POR_PAGINA } : {}),
      }),
      paginada ? db.creditAccount.count({ where }) : Promise.resolve(null),
      opts.caixas === false ? SEM_CAIXAS : CaixasService.saldoPorCliente(tenantId),
      paginada
        ? db.creditAccount.findMany({
            where: {
              status: "EM_ABERTO",
              ...(search ? { customerName: { contains: search, mode: "insensitive" as const } } : {}),
            },
            select: { customerName: true, totalAmount: true, paidAmount: true, dueDate: true, createdAt: true },
          })
        : Promise.resolve(null),
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
    const emAberto = abertasDaBusca
      ? abertasDaBusca.map((c) => ({
          customerName: c.customerName,
          dueDate: c.dueDate,
          createdAt: c.createdAt,
          saldo: FinancialCalc.saldoFiado(c.totalAmount, c.paidAmount),
        }))
      : withSaldo.filter((c) => c.status === "EM_ABERTO");
    const totalGeral = add(...emAberto.map((c) => c.saldo));
    // Atrasada: vencimento antes de HOJE no fuso do app, ou sem vencimento e
    // aberta há mais de 30 dias — a régua do aviso e do relatório.
    const agora = opts.agora ?? new Date();
    const vencidas = emAberto.filter((c) => fiadoAtrasado(c, agora)).length;
    // O saldo de caixas é por CLIENTE, não por conta. Cada venda fiada abre uma
    // conta nova (vendas.service.ts:607), então um cliente que compra a prazo
    // duas vezes tem duas contas em aberto — e somar linha a linha contava o
    // saldo dele uma vez por conta. O painel mostrava o dobro (ou o triplo) de
    // caixas na rua, justamente para o cliente que mais compra.
    // Por identidade do cliente: "Zé" e "zé" são o mesmo saldo (ver `saldoPorCliente`).
    const totalCaixas = [
      ...new Set(emAberto.map((c) => c.customerName.trim().toLocaleLowerCase("pt-BR"))),
    ].reduce(
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

  /** `caixas: false` — ver `listOpen`. */
  async get(tenantId: string, id: string, opts: { caixas?: boolean } = {}) {
    const db = getTenantPrisma(tenantId);
    const conta = await db.creditAccount.findFirst({
      where: { id },
      include: {
        payments: { orderBy: { paidAt: "desc" } },
        sale: { include: SALE_INCLUDE },
      },
    });
    if (!conta) throw new NotFoundError("Conta de fiado não encontrada");

    const caixasPorCliente =
      opts.caixas === false ? SEM_CAIXAS : await CaixasService.saldoPorCliente(tenantId);
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

    const agora = new Date();
    const temRecebimentoVivo = conta.payments.some((p) => !p.reversedAt);
    const vendaNoPrazo = dentroDoPrazoDeDesfazer(conta.sale?.createdAt ?? conta.createdAt, agora);
    return {
      ...conta,
      // O extrato mostra também o estornado (marcado); `podeEstornar` é o botão.
      // Depois da baixa, só o recebimento DE DEPOIS dela é estornável: o de antes
      // entrou no saldo que foi baixado (ver `estornarPagamento`).
      payments: conta.payments.map((p) => ({
        ...p,
        podeEstornar: this.podeEstornar(p, agora) && (!conta.writtenOffAt || p.aposBaixa),
      })),
      /** Há recebimento que ainda conta? Com ele, a venda não pode ser cancelada. */
      temRecebimentoVivo,
      /**
       * A venda ainda está no prazo de cancelamento? A tela só sugere estornar
       * recebimento para cancelar quando está — fora dele, o estorno tiraria do
       * caixa um dinheiro real sem o cancelamento acontecer.
       */
      vendaNoPrazo,
      /** O botão "Cancelar venda": as mesmas condições de `VendasService.podeCancelar`. */
      podeCancelarVenda: !temRecebimentoVivo && vendaNoPrazo && conta.status !== "PERDA",
      /** A baixa como perda ainda pode ser desfeita (regra única de desfazer). */
      podeDesfazerBaixa:
        conta.status === "PERDA" &&
        conta.writtenOffAt !== null &&
        dentroDoPrazoDeDesfazer(conta.writtenOffAt, agora),
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
        // O reenvio depois de um timeout devolve a venda já gravada — sem isto
        // a venda, a baixa de estoque e a conta saíam em dobro.
        idempotencyKey: input.idempotencyKey,
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

    // A mudança e o registro dela commitam juntos (regra 5).
    return db.$transaction(async (tx) => {
      const updated = await tx.creditAccount.update({
        where: { id: before.id },
        data: {
          customerPhone: input.customerPhone ?? null,
          dueDate: input.dueDate ? parseFormDateTz(input.dueDate) : null,
          notes: input.notes ?? null,
        },
      });

      await audit(
        {
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
        },
        tx,
      );
      return updated;
    });
  },

  /**
   * "Excluir" um fiado é CANCELAR a venda que o gerou.
   *
   * Antes o fiado sem pagamento era APAGADO — venda, movimentos de estoque e de
   * caixas —, a qualquer tempo: um lançamento de meses atrás sumia e reescrevia
   * um fechamento que a venda à vista, de propósito, não deixa reescrever. Agora
   * há um caminho só para desfazer venda (`VendasService.cancelarVenda`): o
   * mesmo prazo, a venda fica no histórico marcada como cancelada, o estoque e
   * as caixas voltam com lançamento de estorno, e a conta a receber sai. Venda
   * mista (parte no balcão) também: a parte paga no balcão é devolvida ao
   * cliente junto com a venda.
   *
   * Recebimento vivo na conta recusa — estorne-o antes (`estornarPagamento`).
   */
  async cancelarVendaDoFiado(input: CancelarFiadoInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const conta = await db.creditAccount.findFirst({
      where: { id: input.id },
      select: { id: true, saleId: true, customerName: true, createdAt: true },
    });
    if (!conta) throw new NotFoundError("Conta de fiado não encontrada");

    if (!conta.saleId) return this.removerContaSemVenda(conta, ctx);

    const r = await VendasService.cancelarVenda(
      { id: conta.saleId, motivo: input.motivo ?? null },
      ctx,
    );
    return {
      id: conta.id,
      customerName: conta.customerName,
      caixasEstornadas: r.caixasEstornadas,
      /** Caixas da venda que o cliente já tinha devolvido — não voltam de novo. */
      caixasNaoEstornadas: r.caixasNaoEstornadas,
    };
  },

  /**
   * Conta antiga, de antes de o fiado manual passar pela venda: não há venda,
   * estoque nem caixas a devolver — só a conta a receber. Mesmas regras de
   * desfazer: o dono, dentro do prazo e sem recebimento vivo.
   */
  async removerContaSemVenda(
    conta: { id: string; customerName: string; createdAt: Date },
    ctx: TenantCtx,
  ) {
    if (!podeDesfazer(ctx.session.role)) {
      throw new ForbiddenError("Só o responsável pela empresa pode excluir um fiado.");
    }
    if (!dentroDoPrazoDeDesfazer(conta.createdAt)) {
      throw new BusinessRuleError(foraDoPrazoDeDesfazer("excluir este fiado"));
    }
    const db = getTenantPrisma(ctx.tenantId);
    await db.$transaction(async (tx) => {
      const { count } = await tx.creditAccount.updateMany({
        where: { id: conta.id, paidAmount: 0 },
        data: { deletedAt: new Date() },
      });
      if (count !== 1) {
        throw new BusinessRuleError(
          "Esta conta tem recebimento lançado. Estorne o recebimento antes de excluir.",
        );
      }
      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "DELETE",
          entity: "CreditAccount",
          entityId: conta.id,
          oldData: { customerName: conta.customerName },
          ip: ctx.ip,
        },
        tx,
      );
    });
    return { id: conta.id, customerName: conta.customerName, caixasEstornadas: 0, caixasNaoEstornadas: 0 };
  },

  /**
   * Baixa como PERDA o saldo de um fiado que não vai ser pago (cliente sumiu,
   * faliu, valor descoberto errado tarde demais para cancelar a venda).
   *
   * Sem isto, o fiado incobrável depois das 24 h não tinha saída: ficava na
   * lista de cobrança e no "a receber" para sempre, e o aviso de fiado vencido
   * voltava todo dia. Desfazer a VENDA não é a resposta — ela aconteceu, a
   * mercadoria saiu.
   *
   * A conta fica na base com `status = PERDA`, o saldo do momento em
   * `writtenOffAmount` e a data em `writtenOffAt`. A perda entra no resultado
   * do mês da BAIXA ("Perda com fiado"), não no da venda: o fechamento daquele
   * mês não é reescrito (regra única de desfazer).
   */
  async baixarComoPerda(input: BaixaPerdaInput, ctx: TenantCtx) {
    if (!podeDesfazer(ctx.session.role)) {
      throw new ForbiddenError("Só o responsável pela empresa pode baixar um fiado como perda.");
    }
    const db = getTenantPrisma(ctx.tenantId);
    return db.$transaction(async (tx) => {
      const conta = await tx.creditAccount.findFirst({ where: { id: input.id } });
      if (!conta) throw new NotFoundError("Conta de fiado não encontrada");
      if (conta.status === "PERDA") {
        throw new BusinessRuleError("Este fiado já foi baixado como perda.");
      }
      const saldo = FinancialCalc.saldoFiado(conta.totalAmount, conta.paidAmount);
      if (conta.status !== "EM_ABERTO" || !gt(saldo, 0)) {
        throw new BusinessRuleError("Este fiado não tem saldo em aberto.");
      }

      // `paidAmount` e `status` na condição: um recebimento simultâneo mudaria
      // o saldo que está sendo baixado (mesmo padrão de `registrarPagamento`).
      const escrito = await tx.creditAccount.updateMany({
        where: { id: conta.id, paidAmount: conta.paidAmount, status: "EM_ABERTO" },
        data: {
          status: "PERDA",
          writtenOffAt: new Date(),
          writtenOffAmount: saldo,
          writtenOffReason: input.motivo,
        },
      });
      if (escrito.count !== 1) {
        throw new BusinessRuleError(
          "Outro lançamento desta conta foi registrado agora mesmo. Confira o saldo e tente de novo.",
        );
      }

      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "STATUS_CHANGE",
          entity: "CreditAccount",
          entityId: conta.id,
          oldData: { status: conta.status, saldo: saldo.toString() },
          newData: { status: "PERDA", perda: saldo.toString(), motivo: input.motivo },
          ip: ctx.ip,
        },
        tx,
      );
      return tx.creditAccount.findFirstOrThrow({ where: { id: conta.id } });
    });
  },

  /** Desfaz a baixa como perda lançada errada — até 24 h, a regra única de desfazer. */
  async desfazerBaixa(input: DesfazerBaixaInput, ctx: TenantCtx) {
    if (!podeDesfazer(ctx.session.role)) {
      throw new ForbiddenError("Só o responsável pela empresa pode desfazer a baixa.");
    }
    const db = getTenantPrisma(ctx.tenantId);
    return db.$transaction(async (tx) => {
      const conta = await tx.creditAccount.findFirst({ where: { id: input.id } });
      if (!conta) throw new NotFoundError("Conta de fiado não encontrada");
      if (conta.status !== "PERDA" || !conta.writtenOffAt) {
        throw new BusinessRuleError("Este fiado não está baixado como perda.");
      }
      if (!dentroDoPrazoDeDesfazer(conta.writtenOffAt)) {
        throw new BusinessRuleError(foraDoPrazoDeDesfazer("desfazer esta baixa"));
      }
      const recebidoDepois = await tx.creditPayment.count({
        where: { accountId: conta.id, aposBaixa: true, reversedAt: null },
      });
      if (recebidoDepois > 0) {
        throw new BusinessRuleError(
          "Já houve recebimento depois da baixa. Estorne-o antes de desfazer a baixa.",
        );
      }
      // `paidAmount` na condição: um recebimento depois da baixa que commitou
      // entre a contagem acima e aqui deixaria uma "recuperação" sem perda.
      const { count } = await tx.creditAccount.updateMany({
        where: { id: conta.id, status: "PERDA", paidAmount: conta.paidAmount },
        data: {
          status: "EM_ABERTO",
          writtenOffAt: null,
          writtenOffAmount: null,
          writtenOffReason: null,
        },
      });
      if (count !== 1) {
        throw new BusinessRuleError(
          "Outro lançamento desta conta foi registrado agora mesmo. Confira e tente de novo.",
        );
      }

      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "STATUS_CHANGE",
          entity: "CreditAccount",
          entityId: conta.id,
          oldData: {
            status: "PERDA",
            perda: conta.writtenOffAmount?.toString() ?? null,
            motivo: conta.writtenOffReason,
          },
          newData: { status: "EM_ABERTO", motivo: "baixa-desfeita" },
          ip: ctx.ip,
        },
        tx,
      );
      return tx.creditAccount.findFirstOrThrow({ where: { id: conta.id } });
    });
  },

  /** O recebimento ainda pode ser estornado? (A tela usa para mostrar o botão.) */
  podeEstornar(pagamento: { createdAt: Date; reversedAt: Date | null }, agora = new Date()) {
    return !pagamento.reversedAt && dentroDoPrazoDeDesfazer(pagamento.createdAt, agora);
  },

  /**
   * Estorna um recebimento de fiado lançado errado — valor, forma ou conta
   * trocados. Até 24 h do registro, a regra única de desfazer.
   *
   * O `CreditPayment` FICA no extrato, marcado com `reversedAt`: some do fluxo
   * de caixa e o valor volta ao saldo do cliente. Apagar a linha esconderia que
   * o dinheiro chegou a ser lançado; deixá-la sem marca contaria o dinheiro.
   *
   * Sem isto, um recebimento errado travava a conta para sempre — cancelar a
   * venda e excluir o fiado recusam conta com recebimento, e a tela de venda
   * mandava "estornar o pagamento no fiado" por um caminho que não existia.
   */
  async estornarPagamento(input: EstornoRecebimentoInput, ctx: TenantCtx) {
    if (!podeDesfazer(ctx.session.role)) {
      throw new ForbiddenError("Só o responsável pela empresa pode estornar um recebimento.");
    }
    const db = getTenantPrisma(ctx.tenantId);
    return db.$transaction(async (tx) => {
      const pagamento = await tx.creditPayment.findFirst({ where: { id: input.paymentId } });
      if (!pagamento) throw new NotFoundError("Recebimento não encontrado");
      if (pagamento.reversedAt) throw new BusinessRuleError("Este recebimento já foi estornado.");
      if (!this.podeEstornar(pagamento)) {
        throw new BusinessRuleError(foraDoPrazoDeDesfazer("estornar este recebimento"));
      }
      const conta = await tx.creditAccount.findFirst({ where: { id: pagamento.accountId } });
      if (!conta) throw new NotFoundError("Conta de fiado não encontrada");
      // O estorno reabre a conta (`status: EM_ABERTO`) e desfaria a baixa em
      // silêncio, com a perda ainda no resultado do mês.
      // O recebimento de ANTES da baixa entrou no saldo que foi baixado; estorná-lo
      // mudaria uma perda já lançada. O de DEPOIS (`aposBaixa`) é recuperação, e
      // o estorno devolve a conta à situação de baixada.
      if (conta.writtenOffAt && !pagamento.aposBaixa) {
        throw new BusinessRuleError(
          "Este fiado foi baixado como perda. Desfaça a baixa antes de estornar este recebimento.",
        );
      }
      const statusDepois = conta.writtenOffAt ? "PERDA" : "EM_ABERTO";

      // Guarda contra o clique duplo: o perdedor espera o lock da linha e não
      // casa mais `reversedAt: null`.
      const marcado = await tx.creditPayment.updateMany({
        where: { id: pagamento.id, reversedAt: null },
        data: { reversedAt: new Date(), reversedReason: input.motivo || null },
      });
      if (marcado.count !== 1) throw new BusinessRuleError("Este recebimento já foi estornado.");

      // Mesmo cuidado de `registrarPagamento`: o `paidAmount` lido entra na
      // condição, para um pagamento simultâneo não ser sobrescrito.
      const novoPago = sub(conta.paidAmount, pagamento.amount);
      const escrito = await tx.creditAccount.updateMany({
        // `status` na condição: uma baixa como perda simultânea mudaria o status
        // que este estorno vai gravar (EM_ABERTO por cima de PERDA).
        where: { id: conta.id, paidAmount: conta.paidAmount, status: conta.status },
        data: { paidAmount: novoPago, status: statusDepois },
      });
      if (escrito.count !== 1) {
        throw new BusinessRuleError(
          "Outro lançamento desta conta foi registrado agora mesmo. Confira o saldo e tente de novo.",
        );
      }

      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "PAYMENT_REVERSED",
          entity: "CreditAccount",
          entityId: conta.id,
          oldData: { paidAmount: conta.paidAmount.toString(), status: conta.status },
          newData: {
            paymentId: pagamento.id,
            estornado: pagamento.amount.toString(),
            paidAmount: novoPago.toString(),
            motivo: input.motivo ?? null,
          },
          ip: ctx.ip,
        },
        tx,
      );

      return tx.creditAccount.findFirstOrThrow({ where: { id: conta.id } });
    });
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
    // Reenvio do MESMO recebimento (timeout depois do commit, toque duplo): a
    // guarda por `paidAmount` só pega o simultâneo; o repetido depois baixava
    // a dívida duas vezes e lançava no caixa um dinheiro que não entrou.
    const jaGravado = async () => {
      if (!input.idempotencyKey) return null;
      const p = await db.creditPayment.findFirst({
        where: { idempotencyKey: input.idempotencyKey },
        select: { accountId: true },
      });
      return p ? db.creditAccount.findFirstOrThrow({ where: { id: p.accountId } }) : null;
    };
    const anterior = await jaGravado();
    if (anterior) return anterior;
    try {
      return await this.gravarPagamento(input, ctx);
    } catch (e) {
      if (ehConflitoDeIdempotencia(e)) {
        const gravado = await jaGravado();
        if (gravado) return gravado;
      }
      throw e;
    }
  },

  async gravarPagamento(input: PagamentoFiadoInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    return db.$transaction(async (tx) => {
      const conta = await tx.creditAccount.findFirst({ where: { id: input.accountId } });
      if (!conta) throw new NotFoundError("Conta de fiado não encontrada");
      // Conta baixada como perda RECEBE: o cliente que aparece meses depois para
      // pagar. O dinheiro é recuperação (`aposBaixa`) e entra no resultado do
      // mês do recebimento — a perda do mês da baixa fica como foi lançada.
      const aposBaixa = conta.status === "PERDA";

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
          aposBaixa,
          idempotencyKey: input.idempotencyKey ?? null,
        },
      });

      const novoPago = add(conta.paidAmount, input.amount);
      const quitado = !gt(conta.totalAmount, novoPago); // total <= pago
      const status = quitado ? "PAGO" : aposBaixa ? "PERDA" : "EM_ABERTO";

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
        // `status` na condição: uma baixa como perda simultânea não pode ser
        // desfeita por este recebimento.
        where: { id: conta.id, paidAmount: conta.paidAmount, status: conta.status },
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
          newData: { paidAmount: novoPago.toString(), status, aposBaixa },
          ip: ctx.ip,
        },
        tx,
      );

      // Relê depois da guarda: o registro devolvido é o que ficou gravado.
      return tx.creditAccount.findFirstOrThrow({ where: { id: conta.id } });
    });
  },
};
