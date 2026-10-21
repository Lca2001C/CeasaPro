import { Prisma } from "@prisma/client";
import type { PaymentMethod } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { audit } from "@/lib/audit";
import { add, money, toDecimal } from "@/lib/money";
import {
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/http/app-error";
import { isModuleEnabled } from "@/lib/plan/modules";
import { passaDoEstoque } from "@/lib/estoque/nivel";
import { ComprasService, type UltimaCompraDoProduto } from "./compras.service";
import { FinancialCalc } from "./financial-calc.service";
import { CaixasService } from "./caixas.service";
import { saldoECustoMedio } from "./estoque.service";
import { ORIGEM_VENDA, ORIGEM_VENDA_CANCELADA } from "@/lib/estoque/origens";
import {
  HORAS_PARA_DESFAZER,
  dentroDoPrazoDeDesfazer,
  foraDoPrazoDeDesfazer,
  podeDesfazer,
} from "@/lib/desfazer/prazo";
import { addDaysTz, endOfDayTz, parseFormDateTz, startOfDayTz, startOfMonthTz } from "@/lib/tz";
import { resolvePlasticCrateQty } from "@/lib/validations/venda";
import {
  calcularTotaisVenda,
  centsParaString,
  paraCentavos,
  parteEmDinheiroCents,
} from "@/lib/venda/total";
import type {
  CancelarVendaInput,
  VendaFiltro,
  VendaInput,
  VendaPagamentoInput,
} from "@/lib/validations/venda";
import type { TenantCtx } from "@/lib/http/with-action";

/** Quantas vendas cada página do histórico carrega. */
export const VENDAS_POR_PAGINA = 50;

/**
 * Reexportado de `validations/venda` — a resolução mora lá porque o refine que
 * exige o cliente precisa da MESMA resposta que o serviço vai gravar. Continua
 * visível aqui para não quebrar quem já importava do serviço.
 */
export { resolvePlasticCrateQty };

/**
 * Até quando uma venda pode ser cancelada — a regra única de desfazer
 * lançamento (`src/lib/desfazer/prazo.ts`), a mesma da compra e do
 * recebimento de fiado.
 */
export const HORAS_PARA_CANCELAR = HORAS_PARA_DESFAZER;

/**
 * Forma de pagamento "predominante" de uma venda mista.
 *
 * `Sale.paymentMethod` continua existindo com o mesmo significado para quem já
 * o consome (badge, relatório de vendas, fiado). Numa venda mista guardamos:
 * FIADO se qualquer parcela for fiada — porque existe conta a receber e ela
 * precisa aparecer como tal — senão a forma de maior valor.
 */
export function formaPredominante(
  payments: VendaPagamentoInput[],
  fallback: PaymentMethod,
): PaymentMethod {
  if (payments.length === 0) return fallback;
  if (payments.some((p) => p.method === "FIADO")) return "FIADO";
  return payments.reduce((maior, p) => (p.amount > maior.amount ? p : maior)).method;
}

/** Recusa por recebimento vivo no fiado — e o caminho para resolver. */
function recebimentoNoFiado(): BusinessRuleError {
  return new BusinessRuleError(
    "Esta venda fiada tem recebimento lançado. Estorne o recebimento na tela do fiado " +
      `(até ${HORAS_PARA_DESFAZER} h depois de lançado) e cancele a venda em seguida.`,
  );
}

/** Nome do índice único que garante uma venda por chave de idempotência. */
const INDICE_IDEMPOTENCIA = "sales_tenantId_idempotencyKey_key";

/**
 * O erro é a colisão da chave de idempotência (e não outra unicidade qualquer)?
 *
 * Conferir o alvo do P2002 importa: tratar QUALQUER violação de unicidade como
 * retentativa devolveria "sucesso" para uma venda que na verdade não foi
 * gravada.
 */
function ehConflitoDeIdempotencia(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  const alvo = (e.meta as { target?: unknown } | undefined)?.target;
  if (typeof alvo === "string") return alvo === INDICE_IDEMPOTENCIA;
  if (Array.isArray(alvo)) return alvo.includes("idempotencyKey");
  return false;
}

/**
 * Faz as parcelas somarem EXATAMENTE o total, absorvendo o resíduo numa delas.
 *
 * A validação tolera um centavo, porque o operador digita as parcelas à mão e
 * "3,33 + 3,33 + 3,34 = 10,00" tem de passar. Mas gravar a folga deixaria
 * `sale_payments` sem fechar com `sales.totalAmount` — e o fluxo de caixa soma
 * as parcelas enquanto o relatório de vendas soma o total, então as duas
 * visões da mesma venda divergiriam sem nada acusar.
 *
 * O resíduo vai para a maior parcela NÃO fiada. Mexer numa parcela fiada
 * mudaria o valor da conta a receber, que é o que o cliente vai pagar depois;
 * só se recorre a ela quando a venda é inteiramente fiada.
 */
export function ajustarParcelasAoTotal(
  parcelas: readonly VendaPagamentoInput[],
  totalCents: bigint,
): { method: PaymentMethod; cents: bigint }[] {
  const ajustadas = parcelas.map((p) => ({ method: p.method, cents: paraCentavos(p.amount) }));
  const resto = totalCents - ajustadas.reduce((a, p) => a + p.cents, 0n);
  if (resto === 0n || ajustadas.length === 0) return ajustadas;

  const naoFiadas = ajustadas.filter((p) => p.method !== "FIADO");
  const candidatas = naoFiadas.length > 0 ? naoFiadas : ajustadas;
  const alvo = candidatas.reduce((maior, p) => (p.cents > maior.cents ? p : maior));
  alvo.cents += resto;
  return ajustadas;
}

/**
 * O que a venda grava além do que vem no corpo do PDV.
 *
 * Só o fiado manual usa: a observação é da conta a receber, e não da venda.
 * Antes ela (e o telefone) entrava num `update` solto DEPOIS do commit da
 * venda, fora da transação e sem auditoria; se esse update falhasse, a tela
 * respondia erro com a venda já gravada, e a retentativa duplicava a baixa.
 */
export interface OpcoesDaVenda {
  observacaoDoFiado?: string | null;
}

export const VendasService = {
  /**
   * Último preço praticado por produto.
   *
   * No PDV o preço entrava zerado e o operador digitava de novo a cada venda —
   * no mesmo produto, quase sempre pelo mesmo valor. Sugerir o último preço
   * elimina a digitação no caso comum; o campo continua editável, então nada
   * é imposto.
   *
   * `DISTINCT ON` resolve "o mais recente de cada produto" numa varredura só,
   * em vez de uma consulta por produto.
   */
  async ultimosPrecos(tenantId: string): Promise<Record<string, number>> {
    const rows = await prisma.$queryRaw<{ productId: string; unitPrice: Prisma.Decimal }[]>`
      SELECT DISTINCT ON (si."productId") si."productId", si."unitPrice"
      FROM sale_items si
      JOIN sales s ON s.id = si."saleId"
      WHERE si."tenantId" = ${tenantId} AND s."deletedAt" IS NULL AND s."cancelledAt" IS NULL
      ORDER BY si."productId", s."saleDate" DESC, si."createdAt" DESC
    `;
    const mapa: Record<string, number> = {};
    for (const r of rows) mapa[r.productId] = Number(r.unitPrice);
    return mapa;
  },

  /**
   * Nomes de clientes já usados, para autocompletar no fiado.
   * Evita o mesmo cliente virar "João", "joao" e "JOÃO" — três saldos
   * separados, já que o fiado agrupa caixas plásticas pelo nome.
   */
  async clientesConhecidos(tenantId: string): Promise<string[]> {
    const rows = await prisma.$queryRaw<{ customerName: string }[]>`
      SELECT DISTINCT "customerName"
      FROM sales
      WHERE "tenantId" = ${tenantId}
        AND "deletedAt" IS NULL
        AND "cancelledAt" IS NULL
        AND "customerName" IS NOT NULL
        AND "customerName" <> ''
        -- Só quem comprou no último ano: o DISTINCT varria o histórico inteiro
        -- de vendas a cada abertura do PDV, e cliente sumido há mais de um ano
        -- não precisa de autocompletar.
        AND "saleDate" >= ${addDaysTz(new Date(), -365)}
      ORDER BY "customerName" ASC
      LIMIT 500
    `;
    return rows.map((r) => r.customerName);
  },

  /**
   * Produtos mais vendidos nos últimos N dias.
   *
   * Com a busca vazia o PDV mostrava os 8 primeiros em ordem alfabética — que
   * não são os que giram. No balcão, quase toda venda é o mesmo punhado de
   * itens; começar por eles corta digitação em quase toda venda.
   */
  async maisVendidos(tenantId: string, dias = 30, limite = 12): Promise<string[]> {
    return (await this.rankingDeVendas(tenantId, dias)).slice(0, limite);
  },

  /**
   * Todos os produtos vendidos nos últimos N dias, do que mais gira para o que
   * menos gira (número de vendas, depois quantidade). Produto sem venda no
   * período não entra. Um critério só para o PDV e para as Cotações — "mais
   * vendido" não pode significar uma coisa em cada tela.
   */
  async rankingDeVendas(tenantId: string, dias = 30): Promise<string[]> {
    const desde = addDaysTz(new Date(), -dias);
    const rows = await prisma.$queryRaw<{ productId: string }[]>`
      SELECT si."productId"
      FROM sale_items si
      JOIN sales s ON s.id = si."saleId"
      WHERE si."tenantId" = ${tenantId}
        AND s."deletedAt" IS NULL AND s."cancelledAt" IS NULL
        AND s."saleDate" >= ${desde}
      GROUP BY si."productId"
      ORDER BY COUNT(*) DESC, SUM(si.quantity) DESC
    `;
    return rows.map((r) => r.productId);
  },

  /**
   * Preço sugerido a partir da COMPRA, para quando não há venda anterior.
   *
   * Produto novo (ou que voltou depois de semanas) abria com o campo vazio e o
   * operador tinha de lembrar o preço de cabeça. Usa o preço de venda sugerido
   * lançado na compra; se não houver, aplica a margem padrão sobre o custo real.
   */
  async precosSugeridosDaCompra(
    tenantId: string,
    jaLidas?: UltimaCompraDoProduto[],
  ): Promise<Record<string, number>> {
    // A mesma leitura de `ComprasService.ultimosPrecosPagos` — o PDV a faz uma
    // vez e passa para os dois (ver `ultimaCompraPorProduto`).
    const rows = jaLidas ?? (await ComprasService.ultimaCompraPorProduto(tenantId));
    const mapa: Record<string, number> = {};
    for (const r of rows) {
      const sugerido = r.suggested
        ? toDecimal(r.suggested)
        : FinancialCalc.precoVendaSugerido(r.unitCost);
      const valor = Number(money(sugerido));
      if (valor > 0) mapa[r.productId] = valor;
    }
    return mapa;
  },

  /**
   * A última venda (do cliente, se informado) com os itens prontos para repetir.
   * Cliente recorrente costuma levar a mesma cesta toda semana.
   */
  async ultimaVenda(tenantId: string, customerName?: string) {
    const db = getTenantPrisma(tenantId);
    const venda = await db.sale.findFirst({
      where: {
        cancelledAt: null,
        ...(customerName ? { customerName: { equals: customerName, mode: "insensitive" } } : {}),
      },
      include: { items: { include: { product: true } } },
      orderBy: { saleDate: "desc" },
    });
    if (!venda) return null;
    return {
      id: venda.id,
      saleDate: venda.saleDate,
      customerName: venda.customerName,
      itens: venda.items.map((i) => ({
        productId: i.productId,
        name: i.product.name,
        saleUnit: i.product.saleUnit,
        quantity: Number(i.quantity),
        unitPrice: Number(i.unitPrice),
      })),
    };
  },

  /** `where` do histórico — lista e contagem TÊM de usar o mesmo. */
  filtroDoHistorico(f: VendaFiltro, agora = new Date()): Prisma.SaleWhereInput {
    const where: Prisma.SaleWhereInput = {};
    // Canceladas ficam fora por padrão: continuam na base para auditoria, mas
    // poluiriam a leitura de "o que eu vendi".
    if (!f.incluirCanceladas) where.cancelledAt = null;
    // A forma de pagamento filtra pelas PARCELAS, não pela forma predominante.
    //
    // `Sale.paymentMethod` guarda a predominante (`formaPredominante`): numa
    // venda de R$ 60 no PIX + R$ 40 em dinheiro ela é PIX, e o filtro
    // "Dinheiro" escondia uma venda que pôs R$ 40 na gaveta. Venda antiga,
    // gravada antes das parcelas existirem, não tem `sale_payments`, e para
    // ela a coluna continua sendo a única fonte.
    if (f.paymentMethod) {
      where.OR = [
        { payments: { some: { method: f.paymentMethod } } },
        { payments: { none: {} }, paymentMethod: f.paymentMethod },
      ];
    }
    if (f.q) where.customerName = { contains: f.q, mode: "insensitive" };

    if (f.preset && f.preset !== "todas") {
      const de =
        f.preset === "hoje"
          ? startOfDayTz(agora)
          : f.preset === "semana"
            ? startOfDayTz(addDaysTz(agora, -6))
            : startOfMonthTz(agora);
      where.saleDate = { gte: de, lte: endOfDayTz(agora) };
    }
    return where;
  },

  async list(
    tenantId: string,
    opts: VendaFiltro & { take?: number; skip?: number } = {},
    agora = new Date(),
  ) {
    const db = getTenantPrisma(tenantId);
    return db.sale.findMany({
      where: this.filtroDoHistorico(opts, agora),
      include: {
        items: { include: { product: true } },
        creditAccount: true,
        payments: true,
      },
      orderBy: { saleDate: "desc" },
      take: opts.take ?? VENDAS_POR_PAGINA,
      skip: opts.skip ?? 0,
    });
  },

  async count(tenantId: string, opts: VendaFiltro = {}, agora = new Date()) {
    const db = getTenantPrisma(tenantId);
    return db.sale.count({ where: this.filtroDoHistorico(opts, agora) });
  },

  /**
   * Totais do recorte atual, para o cabeçalho do histórico.
   *
   * Duas regras que a lista não segue, de propósito:
   *
   *  - **Cancelada nunca soma.** "Ver canceladas" existe para CONFERIR o que
   *    foi cancelado; somá-las fazia uma venda de R$ 500 cancelada por engano
   *    aparecer no "Total no período" como faturamento. A lista continua
   *    mostrando a venda (riscada), mas o faturamento é só o de venda válida.
   *  - **Com filtro de forma, o total é o que entrou NAQUELA forma.** Filtrando
   *    "Dinheiro", uma venda de R$ 60 no PIX + R$ 40 em dinheiro soma R$ 40 (o
   *    que foi para a gaveta), não R$ 100. Venda antiga sem parcelas gravadas
   *    entra pelo total, como sempre entrou.
   */
  async totaisDoFiltro(tenantId: string, opts: VendaFiltro = {}, agora = new Date()) {
    const db = getTenantPrisma(tenantId);
    const where: Prisma.SaleWhereInput = {
      ...this.filtroDoHistorico(opts, agora),
      cancelledAt: null,
    };
    const r = await db.sale.aggregate({
      _sum: { totalAmount: true, discountAmount: true },
      _count: { _all: true },
      where,
    });

    let total = toDecimal(r._sum.totalAmount ?? 0);
    if (opts.paymentMethod) {
      const [parcelas, semParcelas] = await Promise.all([
        db.salePayment.aggregate({
          _sum: { amount: true },
          // `deletedAt` vai explícito: a extensão de tenant só o injeta no
          // `where` de topo, e aqui a venda é um filtro de relação. Sem ele, a
          // parcela de uma venda excluída pelo fiado continuaria somando.
          where: { method: opts.paymentMethod, sale: { ...where, deletedAt: null } },
        }),
        db.sale.aggregate({
          _sum: { totalAmount: true },
          where: { ...where, payments: { none: {} } },
        }),
      ]);
      total = add(parcelas._sum.amount ?? 0, semParcelas._sum.totalAmount ?? 0);
    }

    return {
      total: money(total),
      descontos: money(toDecimal(r._sum.discountAmount ?? 0)),
      quantidade: r._count._all,
    };
  },

  async get(tenantId: string, id: string) {
    const db = getTenantPrisma(tenantId);
    const venda = await db.sale.findFirst({
      where: { id },
      include: {
        items: { include: { product: true }, orderBy: { createdAt: "asc" } },
        // Recebimento estornado não conta: foi lançado errado e desfeito.
        creditAccount: { include: { payments: { where: { reversedAt: null } } } },
        payments: { orderBy: { createdAt: "asc" } },
        crateMovements: { orderBy: { movementDate: "asc" } },
      },
    });
    if (!venda) throw new NotFoundError("Venda não encontrada");

    const movimentos = await db.stockMovement.findMany({
      where: { sourceType: ORIGEM_VENDA, sourceId: id },
      include: { product: { select: { name: true } } },
      orderBy: { movedAt: "asc" },
    });

    return {
      ...venda,
      movimentosEstoque: movimentos,
      podeCancelar: this.podeCancelar(venda),
    };
  },

  /**
   * A venda ainda está na janela de cancelamento?
   *
   * Fiado com recebimento (não estornado) não cancela: o dinheiro já entrou, e
   * desfazer a venda deixaria o recebimento órfão. O caminho é estornar o
   * recebimento no fiado (`FiadoService.estornarPagamento`) e cancelar depois.
   *
   * A janela conta do REGISTRO (`createdAt`) — ver `dentroDoPrazoDeDesfazer`.
   * `payments` aqui são só os recebimentos VIVOS (quem chama filtra
   * `reversedAt: null`).
   */
  podeCancelar(
    venda: {
      createdAt: Date;
      cancelledAt: Date | null;
      creditAccount?: { payments?: { id: string }[] } | null;
    },
    agora = new Date(),
  ): boolean {
    if (venda.cancelledAt) return false;
    if ((venda.creditAccount?.payments?.length ?? 0) > 0) return false;
    return dentroDoPrazoDeDesfazer(venda.createdAt, agora);
  },


  /**
   * Cancela uma venda registrada por engano — à vista, fiada ou mista. É o
   * ÚNICO caminho para desfazer venda: excluir o fiado também passa por aqui
   * (`FiadoService.cancelarVendaDoFiado`), com o mesmo prazo e o mesmo
   * resultado. A reversão é atômica e auditada:
   *
   *  1. marca a venda como cancelada (ela FICA na base, para auditoria, e sai
   *     de "Vendi", do CMV e do fluxo de caixa);
   *  2. devolve a mercadoria ao estoque com um `AJUSTE` pelo custo com que ela
   *     SAIU (`unitCostAtSale`) — é a mesma mercadoria, e esse é o custo que foi
   *     pago por ela. Se outra compra entrou no meio, a média se recompõe com
   *     os dois custos, como no estoque físico. Entrar pela média da hora daria
   *     à mercadoria velha o preço da compra nova e inflaria o valor do estoque;
   *  3. estorna as caixas que saíram (voltam limpas: nunca saíram do box);
   *  4. remove a conta de fiado gerada, se não houver recebimento vivo nela.
   *
   * Fora da janela de {@link HORAS_PARA_CANCELAR} horas, recusa: cancelar venda
   * antiga reescreveria fechamento de caixa e relatório já entregues.
   */
  async cancelarVenda(input: CancelarVendaInput, ctx: TenantCtx) {
    // Só o dono da empresa cancela. `requireTenant` já garante OWNER hoje, mas
    // a checagem fica explícita: se um dia existir perfil de operador, esta
    // operação não deve passar a valer para ele em silêncio.
    if (!podeDesfazer(ctx.session.role)) {
      throw new ForbiddenError("Só o responsável pela empresa pode cancelar uma venda.");
    }

    const db = getTenantPrisma(ctx.tenantId);
    const venda = await db.sale.findFirst({
      where: { id: input.id },
      include: {
        items: true,
        creditAccount: { include: { payments: { where: { reversedAt: null } } } },
      },
    });
    if (!venda) throw new NotFoundError("Venda não encontrada");
    if (venda.cancelledAt) throw new BusinessRuleError("Esta venda já foi cancelada.");
    // O prazo ANTES do recebimento: mandar estornar o recebimento de uma venda
    // que já não pode ser cancelada tiraria do caixa um dinheiro real à toa.
    if (!dentroDoPrazoDeDesfazer(venda.createdAt)) {
      throw new BusinessRuleError(foraDoPrazoDeDesfazer("cancelar esta venda"));
    }
    if ((venda.creditAccount?.payments.length ?? 0) > 0) throw recebimentoNoFiado();
    // A perda já entrou no resultado do mês da baixa; cancelar a venda por
    // baixo deixaria a perda de uma venda que não existe mais.
    if (venda.creditAccount?.status === "PERDA") {
      throw new BusinessRuleError(
        "O fiado desta venda foi baixado como perda. Desfaça a baixa antes de cancelar a venda.",
      );
    }
    const productIds = [...new Set(venda.items.map((it) => it.productId))].sort();

    // Quantas caixas voltam ao estoque é decidido DENTRO da transação (abaixo),
    // porque depende do saldo — e um retrato lido aqui fora outra operação já
    // poderia ter invalidado.
    let caixasEstornadas = 0;

    await db.$transaction(async (tx) => {
      // Guarda otimista. A checagem de `venda.cancelledAt` lá em cima acontece
      // FORA da transação: dois cliques no botão (ou uma retentativa depois de
      // um timeout) passavam os dois, e o `update` por id sobrescrevia a marca
      // sem reclamar — a mercadoria voltava ao estoque DUAS vezes, e o estorno
      // de caixas rodava duas vezes.
      //
      // Com `cancelledAt: null` no `where`, o perdedor da corrida espera o lock
      // da linha, reavalia o predicado depois do commit do vencedor e acha
      // `count === 0`, parando ANTES de creditar qualquer coisa. É o mesmo
      // padrão de `billing.service.ts:536`, que já fazia certo.
      //
      // `updateMany` continua isolado por empresa: a extensão de tenant injeta
      // `tenantId` e `deletedAt` em operações de escrita com `where`.
      const marcada = await tx.sale.updateMany({
        where: { id: venda.id, cancelledAt: null },
        data: { cancelledAt: new Date(), cancelledReason: input.motivo || null },
      });
      if (marcada.count !== 1) {
        throw new BusinessRuleError("Esta venda já foi cancelada.");
      }

      // Trava os produtos, na ordem de toda escrita de estoque: o cancelamento
      // de compra e a exclusão de produto decidem pelo que entrou no
      // livro-razão, e precisam ver esta devolução ou esperar por ela.
      await tx.$queryRaw`
        SELECT id FROM products
        WHERE "tenantId" = ${ctx.tenantId} AND id = ANY(${productIds}::text[])
        ORDER BY id
        FOR UPDATE
      `;

      await tx.stockMovement.createMany({
        data: venda.items.map((it) => ({
          tenantId: ctx.tenantId,
          productId: it.productId,
          type: "AJUSTE" as const,
          quantity: it.quantity,
          unitCost: it.unitCostAtSale,
          reason: "Devolução por cancelamento de venda",
          sourceType: ORIGEM_VENDA_CANCELADA,
          sourceId: venda.id,
        })),
      });

      // Só volta para o estoque de caixas o que ainda está com o cliente: se ele
      // já devolveu parte, aquelas caixas já foram contabilizadas de volta e
      // estornar de novo deixaria o saldo com clientes negativo.
      //
      // O limite é o saldo DO CLIENTE da venda, não só o da empresa: com outros
      // fregueses segurando caixas, o global cobria as 8 da venda enquanto o
      // cliente só tinha 3, e `registrarInTx` recusava o estorno — a venda
      // ficava impossível de cancelar.
      if (venda.plasticCrateQty > 0) {
        const saldo = await CaixasService.getSaldoInTx(tx, ctx.tenantId);
        const doCliente = venda.customerName
          ? await CaixasService.saldoDoClienteInTx(tx, ctx.tenantId, venda.customerName)
          : saldo.comClientes;
        caixasEstornadas = Math.min(
          venda.plasticCrateQty,
          Math.max(0, doCliente),
          Math.max(0, saldo.comClientes),
        );
      }

      if (caixasEstornadas > 0) {
        await CaixasService.registrarInTx(
          tx,
          {
            type: "ESTORNO_SAIDA",
            quantity: caixasEstornadas,
            customerName: venda.customerName,
            // Na data da VENDA, como a saída que ele anula: com a data de hoje,
            // a venda de 30/09 cancelada em 01/10 deixava 8 caixas "com o
            // cliente" no relatório de setembro e um estorno solto em outubro.
            movementDate: venda.saleDate.toISOString(),
            saleId: venda.id,
            notes: "Estorno pelo cancelamento da venda",
          },
          ctx,

        );
      }

      // A conta de fiado é apagada (soft delete), não zerada: a dívida nunca
      // existiu. Sem pagamentos, não há nada a preservar nela.
      //
      // A checagem "sem recebimento" lá em cima roda FORA da transação: um
      // pagamento que entrasse entre ela e aqui (outra tela aberta) era apagado
      // junto com a conta, e o `CreditPayment` ficava órfão, ainda somando no
      // fluxo de caixa. O filtro `paidAmount: 0` refaz a checagem de forma
      // atômica na própria escrita.
      // Se não casar, a exceção desfaz a transação inteira: nem a venda fica
      // cancelada nem o estoque volta.
      if (venda.creditAccount) {
        const apagada = await tx.creditAccount.updateMany({
          where: { id: venda.creditAccount.id, paidAmount: 0 },
          data: { deletedAt: new Date() },
        });
        if (apagada.count !== 1) throw recebimentoNoFiado();
      }

      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "SALE_CANCELLED",
          entity: "Sale",
          entityId: venda.id,
          oldData: {
            totalAmount: venda.totalAmount.toString(),
            paymentMethod: venda.paymentMethod,
            plasticCrateQty: venda.plasticCrateQty,
          },
          newData: {
            motivo: input.motivo ?? null,
            itensDevolvidos: venda.items.length,
            caixasEstornadas,
            fiadoRemovido: Boolean(venda.creditAccount),
          },
          ip: ctx.ip,
        },
        tx,
      );
    });

    return {
      id: venda.id,
      itensDevolvidos: venda.items.length,
      caixasEstornadas,
      caixasNaoEstornadas: venda.plasticCrateQty - caixasEstornadas,
      fiadoRemovido: Boolean(venda.creditAccount),
    };
  },

  /**
   * Recupera a venda já gravada com esta chave de idempotência.
   *
   * O `include` casa com o que a transação devolve, para o chamador não
   * perceber diferença entre a primeira chamada e a retentativa.
   */
  async porChaveDeIdempotencia(tenantId: string, chave: string) {
    return getTenantPrisma(tenantId).sale.findFirst({
      where: { idempotencyKey: chave },
      include: { items: true, payments: true },
    });
  },

  async registrarVenda(input: VendaInput, ctx: TenantCtx, opcoes: OpcoesDaVenda = {}) {
    const db = getTenantPrisma(ctx.tenantId);

    // Caminho rápido da retentativa: a mesma chave já virou venda?
    //
    // Um "não encontrei" aqui é inofensivo — quem realmente fecha a porta é o
    // índice único, mais abaixo. Este atalho existe para a retentativa comum
    // (rede voltou, operador tocou de novo) não pagar o custo de abrir a
    // transação, travar produtos e falhar no commit.
    if (input.idempotencyKey) {
      const jaExiste = await this.porChaveDeIdempotencia(ctx.tenantId, input.idempotencyKey);
      if (jaExiste) return Object.assign(jaExiste, { jaRegistrada: true });
    }

    try {
      return await this.gravarVenda(db, input, ctx, opcoes);
    } catch (e) {
      // Corrida de verdade: dois toques simultâneos com a mesma chave. O
      // segundo INSERT bloqueia no índice único até o primeiro commitar e então
      // levanta P2002. É ESTE ramo que pega o duplo clique — o atalho lá em
      // cima só pega a retentativa depois de a primeira ter terminado.
      if (input.idempotencyKey && ehConflitoDeIdempotencia(e)) {
        const existente = await this.porChaveDeIdempotencia(ctx.tenantId, input.idempotencyKey);
        if (existente) return Object.assign(existente, { jaRegistrada: true });
      }
      throw e;
    }
  },

  /** O trabalho em si. Separado para `registrarVenda` cuidar só da idempotência. */
  async gravarVenda(
    db: ReturnType<typeof getTenantPrisma>,
    input: VendaInput,
    ctx: TenantCtx,
    opcoes: OpcoesDaVenda = {},
  ) {
    // Fiado de R$ 0,00 é recusado ANTES de qualquer escrita.
    //
    // Com total zero não há o que cobrar, então nenhuma conta a receber nascia,
    // mas a venda, a baixa de estoque e a saída de caixas eram gravadas
    // mesmo assim. No fiado manual a tela respondia erro ("conta não
    // encontrada") depois do commit, e cada nova tentativa baixava o estoque
    // outra vez; no PDV a venda "fiada" sumia da lista do fiado. O schema do
    // fiado manual já exige preço em todo item. Esta é a barreira de quem
    // chegar aqui por outro caminho, inclusive o PDV com preço zero confirmado.
    const temParteFiada =
      input.paymentMethod === "FIADO" || Boolean(input.payments?.some((p) => p.method === "FIADO"));
    if (temParteFiada && calcularTotaisVenda(input).totalCents === 0n) {
      throw new BusinessRuleError(
        "Venda fiada de R$ 0,00 não gera conta a receber. Confira o preço dos itens.",
      );
    }

    const productIds = [...new Set(input.items.map((i) => i.productId))];
    // `parseFormDateTz` e nao `new Date`: `new Date("2026-09-04")` e meia-noite UTC,
    // ou seja, 03/09 as 21h em Sao Paulo. A venda caia no dia ANTERIOR no painel,
    // no historico "hoje", no fluxo de caixa e no relatorio. Estes eram os dois
    // unicos `new Date(<entrada do usuario>)` do projeto; todo o resto ja usava a
    // conversao com fuso.
    const saleDate = input.saleDate ? parseFormDateTz(input.saleDate) : new Date();
    // Empresa sem o módulo de caixas não deve ter movimento de caixa criado
    // pelas costas — o servidor validava estoque de caixas limpas mesmo para
    // quem não usa caixa retornável, e barrava a venda por um saldo irrelevante.
    const caixasHabilitado = isModuleEnabled(ctx.session.modules, "caixas");
    const plasticCrateQty = caixasHabilitado ? resolvePlasticCrateQty(input) : 0;

    // Caixa plástica exige cliente, e a conta é a RESOLVIDA, não o campo cru.
    // Sem isto, um POST com `recipientType: "PLASTICA"` e `crateQty` nos itens,
    // mas sem `plasticCrateQty` e sem `customerName`, gravava um movimento de
    // SAÍDA com cliente nulo: as caixas saíam do box e nenhum RETORNO conseguia
    // devolvê-las, porque devolução exige o nome de quem levou.
    //
    // Mora aqui, e não no schema, porque só vale COM o módulo: sem ele as
    // caixas já foram zeradas acima, e o refine (que não conhece o módulo)
    // barrava a venda de balcão por um controle que a empresa não tem.
    if (plasticCrateQty > 0 && !input.customerName?.trim()) {
      const mensagem = "Informe o cliente para controlar as caixas plásticas";
      throw new ValidationError(mensagem, { customerName: mensagem });
    }

    return db.$transaction(async (tx) => {
      // Trava as linhas de produto ANTES de ler o saldo.
      //
      // `stock_movements` é um livro-razão só-de-inserção: não existe linha de
      // saldo para travar, e travar as movimentações existentes não impede a
      // inserção concorrente (é problema de fantasma, não de linha). Travar a
      // linha PAI do produto é o padrão canônico para invariante derivada de
      // ledger — e serializa só as vendas do mesmo produto, na mesma empresa.
      //
      // Sem isto, em READ COMMITTED (o padrão do Postgres), duas vendas
      // simultâneas do mesmo produto liam o mesmo saldo, as duas passavam na
      // validação e o estoque terminava NEGATIVO.
      //
      // `ORDER BY id` é obrigatório: dois carrinhos com os mesmos produtos em
      // ordens diferentes travariam em ordem oposta e entrariam em deadlock.
      //
      // O `FOR UPDATE` substitui — e não acrescenta — a consulta de existência
      // que estava aqui. SQL cru não passa pela extensão de tenant, então o
      // `tenantId` vai explícito, como já é convenção no `estoque.service`.
      const products = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM products
        WHERE "tenantId" = ${ctx.tenantId}
          AND id = ANY(${productIds}::text[])
          AND active = true
          AND "deletedAt" IS NULL
        ORDER BY id
        FOR UPDATE
      `;
      if (products.length !== productIds.length) {
        throw new NotFoundError("Um ou mais produtos nao foram encontrados");
      }

      // Retentativa que esperou no lock acima: a chave já virou venda?
      //
      // Se a primeira requisição passou do tempo-limite do PDV (20 s) mas
      // continuou rodando, a retentativa com a mesma chave não a acha no atalho
      // de `registrarVenda` (ela ainda não tinha feito commit) e fica esperando
      // aqui, no `FOR UPDATE` dos mesmos produtos. Quando o lock solta, a
      // venda já está gravada e o saldo já foi baixado: sem esta releitura, a
      // validação logo abaixo respondia "Estoque insuficiente" para uma venda
      // que existe, e o P2002 do INSERT (o ramo que reconhece a duplicata)
      // nunca era alcançado. Em READ COMMITTED esta consulta, feita depois do
      // lock, já enxerga o commit da primeira.
      if (input.idempotencyKey) {
        const jaGravada = await tx.sale.findFirst({
          where: { idempotencyKey: input.idempotencyKey },
          include: { items: true, payments: true },
        });
        if (jaGravada) return Object.assign(jaGravada, { jaRegistrada: true });
      }

      // 1. Saldo atual por produto + custo médio PONDERADO das entradas.
      //
      // Era `_avg: { unitCost: true }` — média aritmética. Com 100 caixas a
      // R$ 1,00 e 1 caixa a R$ 100,00, o custo real é R$ 1,98 e a média simples
      // dá R$ 50,50. Esse valor era gravado em `unitCostAtSale` e virava a base
      // do CMV, do lucro e da margem — vender 1 caixa a R$ 30,00 aparecia como
      // prejuízo de R$ 20,50 quando deu lucro de R$ 28,02.
      //
      // Uma consulta para os dois (ver `saldoECustoMedio`): eram duas
      // varreduras do mesmo livro-razão com os produtos travados.
      const { saldo: available, custo: costMap } = await saldoECustoMedio(
        tx,
        ctx.tenantId,
        productIds,
      );

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
        // `passaDoEstoque` arredonda os dois lados para 3 casas — a precisão do
        // `Decimal(14,3)` da coluna. É a mesma regra que o PDV usa para avisar
        // antes de finalizar. Comparando com `gt` cru, uma quantidade montada
        // no browser como `0.1 + 0.2` chegava valendo 0.30000000000000004 e o
        // servidor recusava uma venda que cabia — depois de o PDV ter aprovado.
        if (passaDoEstoque(avail, qty)) {
          const prod = await tx.product.findFirst({ where: { id: pid } });
          throw new BusinessRuleError(
            `Estoque insuficiente de ${prod?.name ?? "produto"} (disponível: ${avail.toString()}).`,
          );
        }
      }

      // 3. Cria a venda + itens
      //
      // Três valores diferentes, e a distinção importa: `subtotalAmount` é o
      // bruto (o que a mercadoria valia), `lineTotal` já é líquido do desconto
      // da linha, e `totalAmount` é o que o cliente pagou — é ele que o resto
      // do sistema consome (fluxo de caixa, fiado, lucro).
      // A conta é a do contrato compartilhado (`lib/venda/total`), a MESMA que o
      // PDV e o refine do Zod executam. Antes eram três algoritmos diferentes e
      // a tela podia mostrar R$ 2,23 para uma venda gravada como R$ 2,24.
      const totais = calcularTotaisVenda(input);
      const emDecimal = (centavos: bigint) => new Prisma.Decimal(centsParaString(centavos));

      const somaDasLinhasCents = totais.lineTotalsCents.reduce((a, l) => a + l, 0n);
      if (totais.descontoVendaCents > somaDasLinhasCents) {
        throw new BusinessRuleError("O desconto não pode passar do total da venda.");
      }

      const lineTotals = totais.lineTotalsCents.map(emDecimal);
      const subtotalAmount = emDecimal(totais.subtotalCents);
      const descontoDaVenda = emDecimal(totais.descontoVendaCents);
      const totalAmount = emDecimal(totais.totalCents);

      // Parcelas de pagamento: uma venda de forma única também grava a sua, para
      // o fluxo de caixa ter uma fonte só.
      //
      // A validação aceita um centavo de folga (o operador digita as parcelas à
      // mão). Gravar a folga faria `sale_payments` não fechar com
      // `sales.totalAmount`, e o fluxo de caixa soma as parcelas enquanto o
      // relatório de vendas soma o total — as duas visões divergiriam em
      // silêncio. Então o resíduo é absorvido aqui, de preferência numa parcela
      // NÃO fiada: mexer na fiada mudaria o valor da conta a receber.
      const parcelasCents = ajustarParcelasAoTotal(
        input.payments && input.payments.length > 0
          ? input.payments
          : [{ method: input.paymentMethod, amount: Number(totalAmount) }],
        totais.totalCents,
      );
      const parcelas: VendaPagamentoInput[] = parcelasCents.map((p) => ({
        method: p.method,
        amount: Number(centsParaString(p.cents)),
      }));
      const paymentMethod = formaPredominante(parcelas, input.paymentMethod);
      const totalFiado = emDecimal(
        parcelasCents.filter((p) => p.method === "FIADO").reduce((a, p) => a + p.cents, 0n),
      );

      // Troco: conferido contra a PARTE EM ESPÉCIE, nunca contra o total.
      //
      // Numa venda de R$ 100 com R$ 60 em PIX e R$ 40 em dinheiro, o cliente que
      // entrega uma nota de R$ 50 tem R$ 10 de troco. Comparando com o total, o
      // sistema dizia "troco R$ 0,00" e ainda gravava `amountReceived = 100`
      // numa venda em que só entraram R$ 40 em espécie — a conferência de
      // gaveta não fechava nunca.
      const emEspecieCents = parteEmDinheiroCents({ ...input, payments: parcelas });
      const amountReceived =
        emEspecieCents > 0n && input.amountReceived != null
          ? money(toDecimal(input.amountReceived))
          : null;
      const changeGiven = amountReceived
        ? emDecimal(
            (() => {
              const troco = paraCentavos(amountReceived.toFixed(2)) - emEspecieCents;
              return troco > 0n ? troco : 0n;
            })(),
          )
        : null;

      const sale = await tx.sale.create({
        data: {
          tenantId: ctx.tenantId,
          customerName: input.customerName || null,
          customerPhone: input.customerPhone || null,
          saleDate,
          paymentMethod,
          subtotalAmount,
          discountAmount: money(descontoDaVenda),
          discountReason: input.discountReason || null,
          totalAmount,
          amountReceived,
          changeGiven,
          plasticCrateQty,
          idempotencyKey: input.idempotencyKey ?? null,
          items: {
            create: input.items.map((i, idx) => ({
              tenantId: ctx.tenantId,
              productId: i.productId,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              recipientType: i.recipientType ?? null,
              crateQty: i.crateQty ?? 0,
              discountAmount: money(toDecimal(i.discountAmount ?? 0)),
              lineTotal: lineTotals[idx]!,
              unitCostAtSale: costMap.get(i.productId) ?? new Prisma.Decimal(0),
            })),
          },
          payments: {
            create: parcelas.map((p) => ({
              tenantId: ctx.tenantId,
              method: p.method,
              amount: money(toDecimal(p.amount)),
            })),
          },
        },
        include: { items: true, payments: true },
      });

      // 4. Baixa de estoque (SAIDA por item)
      await tx.stockMovement.createMany({
        data: sale.items.map((it) => ({
          tenantId: ctx.tenantId,
          productId: it.productId,
          type: "SAIDA" as const,
          quantity: it.quantity,
          unitCost: it.unitCostAtSale,
          sourceType: ORIGEM_VENDA,
          sourceId: sale.id,
        })),
      });

      // 5. Caixas plásticas que saíram com a mercadoria (livro-razão de caixas)
      if (plasticCrateQty > 0) {
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

        );
      }

      // 6. Fiado → conta a receber, pela PARTE fiada.
      //
      // Numa venda mista ("metade PIX, metade fiado") o cliente deve só a metade
      // fiada. Lançar o total inteiro cobraria duas vezes o que já foi pago.
      if (totalFiado.greaterThan(0)) {
        await tx.creditAccount.create({
          data: {
            tenantId: ctx.tenantId,
            saleId: sale.id,
            customerName: input.customerName!,
            customerPhone: input.customerPhone || null,
            totalAmount: totalFiado,
            paidAmount: new Prisma.Decimal(0),
            status: "EM_ABERTO",
            dueDate: input.dueDate ? parseFormDateTz(input.dueDate) : null,
            notes: opcoes.observacaoDoFiado || null,
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
            subtotalAmount: subtotalAmount.toString(),
            discountAmount: money(descontoDaVenda).toString(),
            discountReason: input.discountReason ?? null,
            totalAmount: totalAmount.toString(),
            paymentMethod: sale.paymentMethod,
            pagamentos: parcelas.map((p) => `${p.method}:${p.amount}`),
            fiado: totalFiado.toString(),
            ...(opcoes.observacaoDoFiado ? { observacaoDoFiado: opcoes.observacaoDoFiado } : {}),
            items: sale.items.length,
            plasticCrateQty,
          },
          ip: ctx.ip,
        },
        tx,
      );

      return Object.assign(sale, { jaRegistrada: false });
    });
  },
};
