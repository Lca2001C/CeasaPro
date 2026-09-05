import { Prisma } from "@prisma/client";
import type { PaymentMethod } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { audit } from "@/lib/audit";
import { money, toDecimal } from "@/lib/money";
import { BusinessRuleError, ForbiddenError, NotFoundError } from "@/lib/http/app-error";
import { isModuleEnabled } from "@/lib/plan/modules";
import { passaDoEstoque } from "@/lib/estoque/nivel";
import { FinancialCalc } from "./financial-calc.service";
import { CaixasService } from "./caixas.service";
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

const IN_TYPES = new Set(["ENTRADA", "AJUSTE"]);

/** Quantas vendas cada página do histórico carrega. */
export const VENDAS_POR_PAGINA = 50;

/**
 * Reexportado de `validations/venda` — a resolução mora lá porque o refine que
 * exige o cliente precisa da MESMA resposta que o serviço vai gravar. Continua
 * visível aqui para não quebrar quem já importava do serviço.
 */
export { resolvePlasticCrateQty };

/**
 * Até quando uma venda pode ser cancelada.
 *
 * Cancelar devolve mercadoria ao estoque e desfaz caixas — mexer numa venda de
 * semanas atrás reescreveria fechamento de caixa e relatório já entregues ao
 * contador. O mesmo dia cobre o caso real (erro de digitação, cliente desistiu)
 * sem abrir essa porta.
 */
export const HORAS_PARA_CANCELAR = 24;

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
      LIMIT ${limite}
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
  async precosSugeridosDaCompra(tenantId: string): Promise<Record<string, number>> {
    const rows = await prisma.$queryRaw<
      { productId: string; suggested: Prisma.Decimal | null; unitCost: Prisma.Decimal }[]
    >`
      SELECT DISTINCT ON (pi."productId")
             pi."productId", pi."suggestedSalePrice" AS suggested, pi."unitCost"
      FROM purchase_items pi
      JOIN purchases p ON p.id = pi."purchaseId"
      WHERE pi."tenantId" = ${tenantId} AND p."deletedAt" IS NULL
      ORDER BY pi."productId", p."purchaseDate" DESC, pi."createdAt" DESC
    `;
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
    if (f.paymentMethod) where.paymentMethod = f.paymentMethod;
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

  /** Totais do recorte atual, para o cabeçalho do histórico. */
  async totaisDoFiltro(tenantId: string, opts: VendaFiltro = {}, agora = new Date()) {
    const db = getTenantPrisma(tenantId);
    const r = await db.sale.aggregate({
      _sum: { totalAmount: true, discountAmount: true },
      _count: { _all: true },
      where: this.filtroDoHistorico(opts, agora),
    });
    return {
      total: money(toDecimal(r._sum.totalAmount ?? 0)),
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
        creditAccount: { include: { payments: true } },
        payments: { orderBy: { createdAt: "asc" } },
        crateMovements: { orderBy: { movementDate: "asc" } },
      },
    });
    if (!venda) throw new NotFoundError("Venda não encontrada");

    const movimentos = await db.stockMovement.findMany({
      where: { sourceType: "SALE", sourceId: id },
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
   * Fiado com pagamento recebido não cancela: o dinheiro já entrou, e desfazer
   * a venda deixaria o recebimento órfão. Nesse caso o caminho é estornar o
   * pagamento no fiado primeiro.
   */
  podeCancelar(
    venda: {
      saleDate: Date;
      cancelledAt: Date | null;
      creditAccount?: { payments?: { id: string }[] } | null;
    },
    agora = new Date(),
  ): boolean {
    if (venda.cancelledAt) return false;
    if ((venda.creditAccount?.payments?.length ?? 0) > 0) return false;
    const limite = venda.saleDate.getTime() + HORAS_PARA_CANCELAR * 3600_000;
    return agora.getTime() <= limite;
  },


  /**
   * Cancela uma venda registrada por engano.
   *
   * Antes só existia saída pelo fiado (excluir a conta), e venda à vista errada
   * obrigava a um ajuste manual de estoque — que ninguém faz na hora, com
   * cliente na frente. Aqui a reversão é atômica e auditada:
   *
   *  1. marca a venda como cancelada (ela FICA na base, para auditoria);
   *  2. devolve a mercadoria ao estoque com um `AJUSTE` — e não `ENTRADA`, de
   *     propósito: `ENTRADA` alimenta a média de custo, e uma devolução por
   *     cancelamento não é compra, distorceria o CMV das próximas vendas;
   *  3. estorna as caixas que saíram (voltam limpas: nunca saíram do box);
   *  4. remove a conta de fiado gerada, se não houver recebimento nela.
   *
   * Fora da janela de {@link HORAS_PARA_CANCELAR} horas, recusa: cancelar venda
   * antiga reescreveria fechamento de caixa e relatório já entregues.
   */
  async cancelarVenda(input: CancelarVendaInput, ctx: TenantCtx) {
    // Só o dono da empresa cancela. `requireTenant` já garante OWNER hoje, mas
    // a checagem fica explícita: se um dia existir perfil de operador, esta
    // operação não deve passar a valer para ele em silêncio.
    if (ctx.session.role !== "OWNER") {
      throw new ForbiddenError("Só o responsável pela empresa pode cancelar uma venda.");
    }

    const db = getTenantPrisma(ctx.tenantId);
    const venda = await db.sale.findFirst({
      where: { id: input.id },
      include: { items: true, creditAccount: { include: { payments: true } } },
    });
    if (!venda) throw new NotFoundError("Venda não encontrada");
    if (venda.cancelledAt) throw new BusinessRuleError("Esta venda já foi cancelada.");
    if ((venda.creditAccount?.payments.length ?? 0) > 0) {
      throw new BusinessRuleError(
        "Esta venda fiada já teve recebimento. Estorne o pagamento no fiado antes de cancelar.",
      );
    }
    if (!this.podeCancelar(venda)) {
      throw new BusinessRuleError(
        `O cancelamento é permitido até ${HORAS_PARA_CANCELAR}h depois da venda. Para corrigir esta, faça um ajuste de estoque.`,
      );
    }

    // Só volta para o estoque de caixas o que ainda está com o cliente: se ele
    // já devolveu parte, aquelas caixas já foram contabilizadas de volta e
    // estornar de novo deixaria o saldo com clientes negativo.
    const crateSaldo =
      venda.plasticCrateQty > 0 ? await CaixasService.getSaldo(ctx.tenantId) : null;
    const caixasEstornadas = crateSaldo
      ? Math.min(venda.plasticCrateQty, Math.max(0, crateSaldo.comClientes))
      : 0;

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

      await tx.stockMovement.createMany({
        data: venda.items.map((it) => ({
          tenantId: ctx.tenantId,
          productId: it.productId,
          type: "AJUSTE" as const,
          quantity: it.quantity,
          unitCost: it.unitCostAtSale,
          reason: "Devolução por cancelamento de venda",
          sourceType: "SALE_CANCELLED",
          sourceId: venda.id,
        })),
      });

      if (caixasEstornadas > 0 && crateSaldo) {
        await CaixasService.registrarInTx(
          tx,
          {
            type: "ESTORNO_SAIDA",
            quantity: caixasEstornadas,
            customerName: venda.customerName,
            movementDate: new Date().toISOString(),
            saleId: venda.id,
            notes: "Estorno pelo cancelamento da venda",
          },
          ctx,
          crateSaldo,
        );
      }

      // A conta de fiado é apagada (soft delete), não zerada: a dívida nunca
      // existiu. Sem pagamentos, não há nada a preservar nela.
      if (venda.creditAccount) {
        await tx.creditAccount.update({
          where: { id: venda.creditAccount.id },
          data: { deletedAt: new Date() },
        });
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

  async registrarVenda(input: VendaInput, ctx: TenantCtx) {
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
      return Object.assign(await this.gravarVenda(db, input, ctx), { jaRegistrada: false });
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
  ) {
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
    // Saldo lido fora da transação (igual ao fluxo de CaixasService.registrar).
    const crateSaldo =
      plasticCrateQty > 0 ? await CaixasService.getSaldo(ctx.tenantId) : null;

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
