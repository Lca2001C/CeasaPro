import { Prisma } from "@prisma/client";
import type { Expense } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { audit } from "@/lib/audit";
import { FinancialCalc } from "./financial-calc.service";
import { money, toDecimal } from "@/lib/money";
import { NotFoundError, BusinessRuleError } from "@/lib/http/app-error";
import {
  addDaysTz,
  civilParts,
  endOfDayTz,
  isoDateTz,
  parseFormDateTz,
  parseIsoDateTz,
  startOfDayTz,
  startOfMonthTz,
  startOfNextMonthTz,
  zonedTimeToUtc,
} from "@/lib/tz";
import { describeError, logger } from "@/lib/logger";
import { isModuleEnabled } from "@/lib/plan/modules";
import {
  fatiaListaComPrefixo,
  linhaDeDespesa,
  linhasDeHigienizacao,
  type ContaUnificada,
} from "@/lib/despesas/contas-unificadas";
import type {
  DespesaInput,
  DespesaUpdateInput,
  DespesaFiltro,
  CategoriaInput,
  CategoriaUpdateInput,
  MarcarPagoInput,
} from "@/lib/validations/despesa";
import type { TenantCtx } from "@/lib/http/with-action";

/**
 * Quantas despesas cada página da tela carrega.
 *
 * 100 cabe em uma rolagem confortável no celular e mantém a resposta abaixo de
 * poucas dezenas de milissegundos mesmo com anos de histórico.
 */
export const DESPESAS_POR_PAGINA = 100;

/** Quantas contas o resumo "vencendo em breve" mostra na home. */
export const CONTAS_PROXIMAS_LIMITE = 3;

function toDate(v?: string | null): Date | null {
  if (!v) return null;
  return parseFormDateTz(v);
}

async function assertCategory(db: ReturnType<typeof getTenantPrisma>, categoryId?: string | null) {
  if (!categoryId) return null;
  const category = await db.expenseCategory.findFirst({
    where: { id: categoryId },
    select: { id: true },
  });
  if (!category) throw new NotFoundError("Categoria nao encontrada");
  return category.id;
}

/**
 * Traduz os filtros da tela em um `where` do Prisma.
 *
 * Fica isolado aqui porque a listagem, a contagem e o resumo TÊM de concordar:
 * quando a lista e o rodapé de paginação divergem, o usuário vê "página 2 de 3"
 * sem página 2.
 */
export function whereDeFiltro(f: DespesaFiltro, agora = new Date()): Prisma.ExpenseWhereInput {
  const where: Prisma.ExpenseWhereInput = {};
  const condicoes: Prisma.ExpenseWhereInput[] = [];

  if (f.vencidas) {
    // Vencida = pendente com vencimento antes de hoje. O status entra junto de
    // propósito: conta paga com atraso não está "vencida", já foi resolvida.
    where.status = "PENDENTE";
    condicoes.push({ dueDate: { lt: startOfDayTz(agora) } });
  } else if (f.status) {
    where.status = f.status;
  }

  if (f.type) where.type = f.type;
  if (f.categoryId) where.categoryId = f.categoryId;
  if (f.q) where.description = { contains: f.q, mode: "insensitive" };

  const from = toDate(f.from);
  const to = toDate(f.to);
  if (from || to) {
    const campo = f.dateField ?? "dueDate";
    const range: Prisma.DateTimeNullableFilter = {};
    if (from) range.gte = from;
    if (to) range.lte = endOfDayTz(to);
    // Vai para o AND em vez de sobrescrever: com `vencidas` já existe um filtro
    // de `dueDate`, e atribuir aqui apagaria silenciosamente aquele recorte.
    condicoes.push({ [campo]: range } as Prisma.ExpenseWhereInput);
  }

  if (condicoes.length > 0) where.AND = condicoes;
  return where;
}

/** Teto do atalho "vence nos próximos N dias" vindo da URL. */
export const PROXIMOS_DIAS_MAX = 90;

/**
 * Período do filtro a partir da URL de /despesas (`de`, `ate`, `proximos`).
 *
 * A URL é entrada do usuário — link editado à mão, truncado ou colado — e ia
 * crua para `whereDeFiltro`: `?de=abc` virava data inválida e `?proximos=1e400`
 * virava `Infinity` dias, e a tela respondia 500 em vez de ignorar o filtro.
 * Aqui só passa data "YYYY-MM-DD" que existe, e `proximos` só vale como inteiro
 * de 1 a {@link PROXIMOS_DIAS_MAX}. O que não passa é descartado em silêncio,
 * como `paginaDaUrl` já faz com a página.
 */
export function periodoDaUrl(
  sp: { de?: unknown; ate?: unknown; proximos?: unknown },
  agora = new Date(),
): { from?: string; to?: string; proximos: boolean } {
  const n = typeof sp.proximos === "string" ? Number(sp.proximos) : NaN;
  if (Number.isInteger(n) && n > 0) {
    const dias = Math.min(n, PROXIMOS_DIAS_MAX);
    return {
      from: isoDateTz(startOfDayTz(agora)),
      to: isoDateTz(addDaysTz(agora, dias)),
      proximos: true,
    };
  }
  const dia = (v: unknown) =>
    typeof v === "string" && parseIsoDateTz(v) ? v.trim() : undefined;
  return { from: dia(sp.de), to: dia(sp.ate), proximos: false };
}

/** Mês seguinte ao vencimento, preservando o dia — 31/01 vira 28/02, não 03/03. */
export function proximoVencimento(dueDate: Date): Date {
  const c = civilParts(dueDate);
  const mes = c.month === 12 ? 1 : c.month + 1;
  const ano = c.month === 12 ? c.year + 1 : c.year;
  // Dia 0 do mês seguinte ao destino = último dia do destino.
  const ultimoDia = civilParts(zonedTimeToUtc(ano, mes + 1, 0)).day;
  return zonedTimeToUtc(ano, mes, Math.min(c.day, ultimoDia), 0, 0, 0, 0);
}

/** Limites do mês de referência "YYYY-MM" (ou do mês corrente). */
function limitesDoMes(ref: string | undefined, agora: Date) {
  if (!ref) {
    return {
      inicio: startOfMonthTz(agora),
      fim: new Date(startOfNextMonthTz(agora).getTime() - 1),
    };
  }
  const [ano, mes] = ref.split("-").map(Number);
  const inicio = zonedTimeToUtc(ano!, mes!, 1);
  const fimExclusivo = zonedTimeToUtc(mes === 12 ? ano! + 1 : ano!, mes === 12 ? 1 : mes! + 1, 1);
  return { inicio, fim: new Date(fimExclusivo.getTime() - 1) };
}

/** Mês anterior ao de referência, em "YYYY-MM". */
export function mesAnterior(ref: string): string {
  const [ano, mes] = ref.split("-").map(Number);
  const m = mes === 1 ? 12 : mes! - 1;
  const a = mes === 1 ? ano! - 1 : ano!;
  return `${a}-${String(m).padStart(2, "0")}`;
}

/** Mês de referência "YYYY-MM" de um instante, no fuso do app. */
export function refMes(d: Date): string {
  const c = civilParts(d);
  return `${c.year}-${String(c.month).padStart(2, "0")}`;
}

export interface ResumoMes {
  /** Pendentes com vencimento dentro do mês (o "quanto eu ainda devo"). */
  aPagar: Prisma.Decimal;
  aPagarCount: number;
  /** Já pagas no mês, por data de PAGAMENTO (o que saiu do caixa). */
  pagas: Prisma.Decimal;
  pagasCount: number;
  /** Fixas e variáveis do mês, por vencimento (a estrutura de custo). */
  fixas: Prisma.Decimal;
  variaveis: Prisma.Decimal;
  /** Vencidas: pendentes com vencimento no passado, de qualquer mês. */
  vencidas: Prisma.Decimal;
  vencidasCount: number;
  /** Mês anterior, para o comparativo. */
  fixasMesAnterior: Prisma.Decimal;
  variaveisMesAnterior: Prisma.Decimal;
  /** Faturamento do mês e quanto dele as despesas consomem. */
  faturamento: Prisma.Decimal;
  percentualDoFaturamento: Prisma.Decimal;
  referencia: string;
}

/** Números da higienização que entram nos cartões de Despesas e do Início. */
export interface ResumoHigienizacao {
  /** Soma de `total − pago` dos lotes que ainda devem (nunca negativo). */
  saldoAberto: Prisma.Decimal;
  /** Quantos lotes ainda devem. */
  abertoCount: number;
  /** Parte de `saldoAberto` de lotes enviados antes de `hoje`. */
  vencido: Prisma.Decimal;
  vencidoCount: number;
  /** O que SAIU do caixa na janela: soma dos pagamentos por `paidAt`. */
  pagaNoPeriodo: Prisma.Decimal;
  /** Quantos lotes receberam algum pagamento na janela. */
  pagaCount: number;
  /** Custo dos lotes ENVIADOS na janela (a estrutura de custo do mês). */
  enviadaNoPeriodo: Prisma.Decimal;
  /** Custo dos lotes enviados na janela `anterior` (zero sem ela). */
  enviadaNoAnterior: Prisma.Decimal;
}

export const HIGIENIZACAO_ZERADA: ResumoHigienizacao = Object.freeze({
  saldoAberto: new Prisma.Decimal(0),
  abertoCount: 0,
  vencido: new Prisma.Decimal(0),
  vencidoCount: 0,
  pagaNoPeriodo: new Prisma.Decimal(0),
  pagaCount: 0,
  enviadaNoPeriodo: new Prisma.Decimal(0),
  enviadaNoAnterior: new Prisma.Decimal(0),
});

type Janela = { inicio: Date; fim: Date };

/**
 * Higienização somada NO BANCO, com o pago contado por PAGAMENTO.
 *
 * `crate_cleanings.paidAmount` é acumulado e `paidDate` guarda só a data do
 * ÚLTIMO pagamento. Somar `paidAmount` filtrando por `paidDate` — como o painel
 * e o resumo de Despesas faziam — jogava o lote inteiro no mês do último
 * pagamento: R$ 300 pagos 100 em agosto e 200 em setembro davam agosto R$ 0 e
 * setembro R$ 300. `crate_cleaning_payments` tem uma linha por pagamento, com
 * a data em que o dinheiro saiu; é a mesma fonte do fluxo de caixa
 * (`report.service.ts`), então o Início, Despesas e o relatório fecham.
 *
 * O saldo em aberto também é SQL: antes cada tela carregava todos os lotes da
 * história para somar em JavaScript, e o custo crescia sem teto.
 *
 * `prisma` cru com `tenantId` explícito nas duas tabelas, no molde das outras
 * agregações do painel. O lote excluído sai pelo `deletedAt` do lote — a linha
 * de pagamento não tem `deletedAt` própria.
 */
export async function resumoDaHigienizacao(
  tenantId: string,
  janela: Janela,
  hoje: Date,
  anterior?: Janela,
): Promise<ResumoHigienizacao> {
  const ant = anterior ?? janela;
  const [lotes, pagos] = await Promise.all([
    prisma.$queryRaw<
      {
        saldo_aberto: Prisma.Decimal | string;
        aberto_count: number;
        vencido: Prisma.Decimal | string;
        vencido_count: number;
        enviada: Prisma.Decimal | string;
        enviada_anterior: Prisma.Decimal | string;
      }[]
    >`
      SELECT
        COALESCE(SUM("totalAmount" - "paidAmount") FILTER (WHERE "totalAmount" > "paidAmount"), 0) AS saldo_aberto,
        COUNT(*) FILTER (WHERE "totalAmount" > "paidAmount")::int AS aberto_count,
        COALESCE(SUM("totalAmount" - "paidAmount") FILTER (WHERE "totalAmount" > "paidAmount" AND "sentDate" < ${hoje}), 0) AS vencido,
        COUNT(*) FILTER (WHERE "totalAmount" > "paidAmount" AND "sentDate" < ${hoje})::int AS vencido_count,
        COALESCE(SUM("totalAmount") FILTER (WHERE "sentDate" >= ${janela.inicio} AND "sentDate" <= ${janela.fim}), 0) AS enviada,
        COALESCE(SUM("totalAmount") FILTER (WHERE "sentDate" >= ${ant.inicio} AND "sentDate" <= ${ant.fim}), 0) AS enviada_anterior
      FROM crate_cleanings
      WHERE "tenantId" = ${tenantId} AND "deletedAt" IS NULL
    `,
    prisma.$queryRaw<{ paga: Prisma.Decimal | string; paga_count: number }[]>`
      SELECT COALESCE(SUM(pg.amount), 0) AS paga,
             COUNT(DISTINCT pg."cleaningId")::int AS paga_count
      FROM crate_cleaning_payments pg
      JOIN crate_cleanings cc ON cc.id = pg."cleaningId"
      WHERE pg."tenantId" = ${tenantId} AND cc."tenantId" = ${tenantId}
        AND cc."deletedAt" IS NULL
        AND pg."paidAt" >= ${janela.inicio} AND pg."paidAt" <= ${janela.fim}
    `,
  ]);
  const l = lotes[0];
  const p = pagos[0];
  const dec = (v: Prisma.Decimal | string | undefined) =>
    money(toDecimal((v ?? 0) as Prisma.Decimal.Value));
  return {
    saldoAberto: dec(l?.saldo_aberto),
    abertoCount: Number(l?.aberto_count ?? 0),
    vencido: dec(l?.vencido),
    vencidoCount: Number(l?.vencido_count ?? 0),
    pagaNoPeriodo: dec(p?.paga),
    pagaCount: Number(p?.paga_count ?? 0),
    enviadaNoPeriodo: dec(l?.enviada),
    enviadaNoAnterior: anterior ? dec(l?.enviada_anterior) : money(toDecimal(0)),
  };
}

/**
 * Pré-filtro no banco para a lista de higienização, a partir do filtro da tela.
 *
 * Devolve `null` quando nenhuma linha de higienização pode passar (tipo FIXA
 * ou categoria escolhida — lote não tem nenhum dos dois). O resto é um
 * SUPERCONJUNTO do que `linhasDeHigienizacao` aceita: ela continua sendo a
 * regra; aqui só se evita trazer para a memória a história inteira de lotes
 * quando a aba ou o período já descartam a maioria.
 */
function whereDaHigienizacao(
  filtro: DespesaFiltro,
  agora: Date,
): Prisma.CrateCleaningWhereInput | null {
  if (filtro.type === "FIXA" || filtro.categoryId) return null;
  const e: Prisma.CrateCleaningWhereInput[] = [];

  if (filtro.vencidas) {
    // Saldo > 0 implica status != PAGO (`computeCleaningStatus` só marca PAGO
    // com o dinheiro quitado), então o recorte por status é seguro.
    e.push({ status: { not: "PAGO" }, sentDate: { lt: startOfDayTz(agora) } });
  } else if (filtro.status === "PAGO") {
    e.push({ paidAmount: { gt: 0 } });
  } else if (filtro.status === "PENDENTE") {
    e.push({ status: { not: "PAGO" } });
  }

  const from = toDate(filtro.from);
  const to = toDate(filtro.to);
  if (from || to) {
    const campo = filtro.dateField ?? "dueDate";
    const range: Prisma.DateTimeFilter = {};
    if (from) range.gte = from;
    if (to) range.lte = endOfDayTz(to);
    if (campo === "paidDate") e.push({ paidDate: range });
    else if (campo === "createdAt") e.push({ createdAt: range });
    else e.push({ sentDate: range });
  }
  return e.length > 0 ? { AND: e } : {};
}

async function higienizacoesFiltradas(
  tenantId: string,
  filtro: DespesaFiltro,
  modules: string[] | undefined,
  agora: Date,
): Promise<ContaUnificada[]> {
  if (!isModuleEnabled(modules, "higienizacao")) return [];
  const where = whereDaHigienizacao(filtro, agora);
  if (!where) return [];
  const db = getTenantPrisma(tenantId);
  const lotes = await db.crateCleaning.findMany({
    where,
    select: {
      id: true,
      cleanerName: true,
      totalAmount: true,
      paidAmount: true,
      sentDate: true,
      paidDate: true,
      createdAt: true,
    },
  });
  const linhas = lotes.flatMap((lote) => linhasDeHigienizacao(lote, filtro, agora));
  const pagas = filtro.status === "PAGO";
  return linhas.sort((a, b) => {
    const dataA = pagas ? a.paidDate : a.dueDate;
    const dataB = pagas ? b.paidDate : b.dueDate;
    if (!dataA && !dataB) return 0;
    if (!dataA) return 1;
    if (!dataB) return -1;
    return pagas ? dataB.localeCompare(dataA) : dataA.localeCompare(dataB);
  });
}

export const DespesasService = {
  // ─────────────────────────── Categorias ───────────────────────────

  async listCategories(tenantId: string) {
    const db = getTenantPrisma(tenantId);
    return db.expenseCategory.findMany({ orderBy: { name: "asc" } });
  },

  /** Categorias com quantas despesas cada uma tem — a tela de gestão precisa. */
  async listCategoriesComUso(tenantId: string) {
    const db = getTenantPrisma(tenantId);
    const [categorias, uso] = await Promise.all([
      db.expenseCategory.findMany({ orderBy: { name: "asc" } }),
      db.expense.groupBy({ by: ["categoryId"], _count: { _all: true } }),
    ]);
    const contagem = new Map(uso.map((u) => [u.categoryId, u._count._all]));
    return categorias.map((c) => ({ ...c, despesas: contagem.get(c.id) ?? 0 }));
  },

  /**
   * Cria a categoria — ou RESSUSCITA a que foi excluída com o mesmo nome.
   *
   * `ExpenseCategory` tem `@@unique([tenantId, name])`, e o índice único não
   * sabe o que é `deletedAt`: a linha excluída continuava ocupando o nome. Como
   * a busca aqui passa pelo client escopado (que injeta `deletedAt: null`), ela
   * não enxergava a linha, o `create` batia no índice e o P2002 chegava à tela
   * como "Ocorreu um erro inesperado (ref: …)". Excluir "Frete" e tentar criar
   * "Frete" de novo era o caminho mais curto para esse erro.
   *
   * Ressuscitar, em vez de carimbar o nome como o projeto faz com `users.email`:
   * nome de categoria é rótulo que o usuário lê, e um "excluido-cmxyz-Frete"
   * apareceria em qualquer listagem que esquecesse o filtro. E a exclusão só é
   * permitida quando a categoria não está em uso, então trazer a linha de volta
   * não recupera classificação nenhuma que estivesse errada.
   */
  async createCategory(input: CategoriaInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const exists = await db.expenseCategory.findFirst({ where: { name: input.name } });
    if (exists) throw new BusinessRuleError("Já existe uma categoria com esse nome");

    // O client cru: precisamos VER a linha excluída, que a extensão esconde.
    const excluida = await prisma.expenseCategory.findFirst({
      where: { tenantId: ctx.tenantId, name: input.name, deletedAt: { not: null } },
    });
    if (excluida) {
      const revivida = await prisma.expenseCategory.update({
        where: { id: excluida.id },
        data: { deletedAt: null },
      });
      await audit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        actorEmail: ctx.session.email,
        action: "UPDATE",
        entity: "ExpenseCategory",
        entityId: revivida.id,
        newData: { name: revivida.name, revivida: true },
        ip: ctx.ip,
      });
      return revivida;
    }

    const c = await db.expenseCategory.create({
      data: { tenantId: ctx.tenantId, name: input.name },
    });
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "CREATE",
      entity: "ExpenseCategory",
      entityId: c.id,
      newData: { name: c.name },
      ip: ctx.ip,
    });
    return c;
  },

  /**
   * Renomear vale também para as categorias padrão: "Pró-labore" pode virar
   * "Retirada do dono" sem perder o histórico já classificado.
   */
  async renameCategory(input: CategoriaUpdateInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const before = await db.expenseCategory.findFirst({ where: { id: input.id } });
    if (!before) throw new NotFoundError("Categoria não encontrada");
    const conflito = await db.expenseCategory.findFirst({
      where: { name: input.name, id: { not: input.id } },
    });
    if (conflito) throw new BusinessRuleError("Já existe uma categoria com esse nome");
    // Mesma armadilha do `create`: uma categoria EXCLUÍDA com o nome de destino
    // é invisível para o client escopado e derrubaria o update com P2002.
    // Aqui o certo é recusar com mensagem, não ressuscitar — quem renomeia não
    // pediu para trazer outra categoria de volta.
    const excluidaComOMesmoNome = await prisma.expenseCategory.findFirst({
      where: {
        tenantId: ctx.tenantId,
        name: input.name,
        deletedAt: { not: null },
        id: { not: input.id },
      },
      select: { id: true },
    });
    if (excluidaComOMesmoNome) {
      throw new BusinessRuleError(
        "Já houve uma categoria com esse nome. Crie-a de novo (ela volta com o histórico) " +
          "ou escolha outro nome.",
      );
    }

    const c = await db.expenseCategory.update({
      where: { id: input.id },
      data: { name: input.name },
    });
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "UPDATE",
      entity: "ExpenseCategory",
      entityId: c.id,
      oldData: { name: before.name },
      newData: { name: c.name },
      ip: ctx.ip,
    });
    return c;
  },

  /**
   * Exclui uma categoria criada pela empresa.
   *
   * Duas travas de produto: as categorias padrão ficam (são a base que o
   * onboarding entrega), e uma categoria em uso não sai — apagá-la deixaria
   * despesas antigas sem classificação e estragaria os relatórios do ano.
   */
  async removeCategory(id: string, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const before = await db.expenseCategory.findFirst({ where: { id } });
    if (!before) throw new NotFoundError("Categoria não encontrada");
    if (before.isDefault) {
      throw new BusinessRuleError(
        "As categorias padrão não podem ser excluídas — mas podem ser renomeadas.",
      );
    }
    const emUso = await db.expense.count({ where: { categoryId: id } });
    if (emUso > 0) {
      throw new BusinessRuleError(
        `Esta categoria está em ${emUso} despesa(s). Troque a categoria delas antes de excluir.`,
      );
    }
    await db.expenseCategory.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "DELETE",
      entity: "ExpenseCategory",
      entityId: id,
      oldData: { name: before.name },
      ip: ctx.ip,
    });
  },

  // ─────────────────────────── Listagem ───────────────────────────

  /**
   * Uma página da listagem de despesas.
   *
   * Antes esta função devolvia TODAS as despesas da empresa, e a tela filtrava,
   * ordenava e somava em JavaScript. Medido com 2 anos de operação (8.000
   * despesas) isso levava ~278 ms no servidor, e o custo cresce linearmente: em
   * 4 anos passa de meio segundo, mais o peso de serializar tudo para o celular
   * do cliente. Filtro, ordem e limite agora são do banco.
   */
  async list(
    tenantId: string,
    opts: DespesaFiltro & { take?: number; skip?: number } = {},
    agora = new Date(),
  ) {
    const db = getTenantPrisma(tenantId);
    return db.expense.findMany({
      where: whereDeFiltro(opts, agora),
      include: { category: true },
      // A ordem reproduz o que a tela fazia em JS: o que vence primeiro no topo,
      // e sem vencimento no fim (não há prazo correndo). Para as já pagas, o
      // PAGAMENTO mais recente primeiro — ali a ordem de vencimento não diz
      // nada. Era `dueDate desc`, e no Postgres DESC põe NULLS FIRST: as pagas
      // sem vencimento, mesmo de anos atrás, abriam a aba, e a conta de janeiro
      // quitada hoje aparecia abaixo da de setembro paga em agosto. Mesmo
      // critério do prefixo de higienização (`paidDate` desc).
      orderBy:
        opts.status === "PAGO"
          ? [{ paidDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }]
          : [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: opts.take ?? DESPESAS_POR_PAGINA,
      skip: opts.skip ?? 0,
    });
  },

  /** Quantas despesas existem no filtro atual (para a paginação). */
  async count(tenantId: string, opts: DespesaFiltro = {}, agora = new Date()) {
    const db = getTenantPrisma(tenantId);
    return db.expense.count({ where: whereDeFiltro(opts, agora) });
  },

  /**
   * Lista unificada: despesas + saldos de higienização (se o plano tiver o módulo).
   *
   * Higienização não vira linha em `expenses` — pagamento parcial e status do
   * lote vivem no próprio módulo. Aqui só lemos o saldo para o dono do box ver
   * "tudo que deve" numa tela só.
   */
  async listContas(
    tenantId: string,
    opts: DespesaFiltro & { take?: number; skip?: number } = {},
    modules?: string[],
    agora = new Date(),
  ): Promise<ContaUnificada[]> {
    const take = opts.take ?? DESPESAS_POR_PAGINA;
    const skip = opts.skip ?? 0;
    const prefixo = await higienizacoesFiltradas(tenantId, opts, modules, agora);
    const fatia = fatiaListaComPrefixo(prefixo.length, skip, take);
    const visiveis = prefixo.slice(fatia.prefixSkip, fatia.prefixSkip + fatia.prefixTake);
    if (fatia.restoTake <= 0) return visiveis;

    const despesas = await DespesasService.list(
      tenantId,
      { ...opts, skip: fatia.restoSkip, take: fatia.restoTake },
      agora,
    );
    return [
      ...visiveis,
      ...despesas.map((d) =>
        linhaDeDespesa(
          {
            id: d.id,
            description: d.description,
            amount: d.amount,
            type: d.type,
            status: d.status,
            paymentMethod: d.paymentMethod,
            recurring: d.recurring,
            categoryName: d.category?.name ?? null,
            dueDate: d.dueDate,
            paidDate: d.paidDate,
          },
          agora,
        ),
      ),
    ];
  },

  async countContas(
    tenantId: string,
    opts: DespesaFiltro = {},
    modules?: string[],
    agora = new Date(),
  ) {
    const [despesas, hig] = await Promise.all([
      DespesasService.count(tenantId, opts, agora),
      higienizacoesFiltradas(tenantId, opts, modules, agora),
    ]);
    return despesas + hig.length;
  },

  /**
   * Totais por tipo, somados NO BANCO.
   *
   * Somam SEMPRE todas as despesas, não só a página nem o filtro: são o retrato
   * histórico do total lançado. Para a leitura do dia a dia ("quanto devo neste
   * mês?") existe `resumoMes` — é ela que a tela mostra nos cards.
   */
  async totais(tenantId: string) {
    const db = getTenantPrisma(tenantId);
    const porTipo = await db.expense.groupBy({
      by: ["type"],
      _sum: { amount: true },
    });
    return FinancialCalc.totaisDespesas(
      porTipo.map((g) => ({ type: g.type, amount: g._sum.amount ?? 0 })),
    );
  },

  /**
   * O resumo que o dono do box realmente lê: quanto ainda devo neste mês,
   * quanto já paguei, e como isso compara com o mês passado.
   *
   * Os cards antigos somavam TODO o histórico enquanto a lista mostrava um
   * filtro — o número no topo nunca fechava com o que estava embaixo. Aqui todo
   * recorte é do mês, e cada card diz de qual data ele fala.
   */
  async resumoMes(
    tenantId: string,
    ref?: string,
    agora = new Date(),
    modules?: string[],
  ): Promise<ResumoMes> {
    const db = getTenantPrisma(tenantId);
    const referencia = ref ?? refMes(agora);
    const mes = limitesDoMes(referencia, agora);
    const anterior = limitesDoMes(mesAnterior(referencia), agora);
    const hoje = startOfDayTz(agora);

    const noMes = { gte: mes.inicio, lte: mes.fim };

    const [aPagar, pagas, porTipo, porTipoAnterior, vencidas, vendas, hig] = await Promise.all([
      db.expense.aggregate({
        _sum: { amount: true },
        _count: { _all: true },
        where: { status: "PENDENTE", dueDate: noMes },
      }),
      db.expense.aggregate({
        _sum: { amount: true },
        _count: { _all: true },
        where: { status: "PAGO", paidDate: noMes },
      }),
      db.expense.groupBy({
        by: ["type"],
        _sum: { amount: true },
        where: { dueDate: noMes },
      }),
      db.expense.groupBy({
        by: ["type"],
        _sum: { amount: true },
        where: { dueDate: { gte: anterior.inicio, lte: anterior.fim } },
      }),
      db.expense.aggregate({
        _sum: { amount: true },
        _count: { _all: true },
        where: { status: "PENDENTE", dueDate: { lt: hoje } },
      }),
      db.sale.aggregate({
        _sum: { totalAmount: true },
        where: { saleDate: noMes, cancelledAt: null },
      }),
      isModuleEnabled(modules, "higienizacao")
        ? resumoDaHigienizacao(tenantId, mes, hoje, anterior)
        : Promise.resolve(HIGIENIZACAO_ZERADA),
    ]);

    const doMes = FinancialCalc.totaisDespesas(
      porTipo.map((g) => ({ type: g.type, amount: g._sum.amount ?? 0 })),
    );
    const doMesAnterior = FinancialCalc.totaisDespesas(
      porTipoAnterior.map((g) => ({ type: g.type, amount: g._sum.amount ?? 0 })),
    );

    // Higienização: saldo em aberto soma no "a pagar" (e no vencido, se o
    // envio é de antes de hoje); "pagas" soma os PAGAMENTOS feitos no mês, não
    // o acumulado do lote — ver `resumoDaHigienizacao`.
    const aPagarValor = money(toDecimal(aPagar._sum.amount ?? 0).plus(hig.saldoAberto));
    const aPagarCount = aPagar._count._all + hig.abertoCount;
    const pagasValor = money(toDecimal(pagas._sum.amount ?? 0).plus(hig.pagaNoPeriodo));
    const pagasCount = pagas._count._all + hig.pagaCount;
    const variaveis = money(doMes.variaveis.plus(hig.enviadaNoPeriodo));
    const variaveisMesAnterior = money(doMesAnterior.variaveis.plus(hig.enviadaNoAnterior));
    const vencidasValor = money(toDecimal(vencidas._sum.amount ?? 0).plus(hig.vencido));
    const vencidasCount = vencidas._count._all + hig.vencidoCount;

    const faturamento = money(toDecimal(vendas._sum.totalAmount ?? 0));
    const geralDoMes = money(doMes.fixas.plus(variaveis));

    return {
      aPagar: aPagarValor,
      aPagarCount,
      pagas: pagasValor,
      pagasCount,
      fixas: doMes.fixas,
      variaveis,
      vencidas: vencidasValor,
      vencidasCount,
      fixasMesAnterior: doMesAnterior.fixas,
      variaveisMesAnterior,
      faturamento,
      percentualDoFaturamento: FinancialCalc.margemLiquida(geralDoMes, faturamento),
      referencia,
    };
  },

  /**
   * As próximas contas a vencer, para o resumo da home.
   * Inclui as já vencidas — elas são as mais urgentes de todas.
   */
  async proximasContas(tenantId: string, dias = 7, agora = new Date()) {
    const db = getTenantPrisma(tenantId);
    const limite = endOfDayTz(new Date(startOfDayTz(agora).getTime() + dias * 864e5));
    const where: Prisma.ExpenseWhereInput = {
      status: "PENDENTE",
      dueDate: { not: null, lte: limite },
    };
    const [itens, total] = await Promise.all([
      db.expense.findMany({
        where,
        include: { category: true },
        orderBy: [{ dueDate: "asc" }],
        take: CONTAS_PROXIMAS_LIMITE,
      }),
      db.expense.aggregate({ _sum: { amount: true }, _count: { _all: true }, where }),
    ]);
    return {
      itens,
      total: money(toDecimal(total._sum.amount ?? 0)),
      count: total._count._all,
    };
  },

  async get(tenantId: string, id: string) {
    const db = getTenantPrisma(tenantId);
    const e = await db.expense.findFirst({ where: { id } });
    if (!e) throw new NotFoundError("Despesa não encontrada");
    return e;
  },

  // ─────────────────────────── Escrita ───────────────────────────

  async create(input: DespesaInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const categoryId = await assertCategory(db, input.categoryId);
    const e = await db.expense.create({
      data: {
        tenantId: ctx.tenantId,
        description: input.description,
        amount: input.amount,
        type: input.type,
        status: input.status,
        categoryId,
        paymentMethod: input.paymentMethod ?? null,
        recurring: input.recurring ?? false,
        dueDate: toDate(input.dueDate),
        paidDate: toDate(input.paidDate),
      },
    });
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "CREATE",
      entity: "Expense",
      entityId: e.id,
      newData: e,
      ip: ctx.ip,
    });
    // Lançar a conta fixa já quitada é comum ("paguei o aluguel e estou
    // registrando agora"). A parcela do mês seguinte tem de nascer aí também.
    if (e.status === "PAGO" && e.recurring) {
      await this.gerarProximaParcela(e, ctx).catch((err) =>
        logger.error({ err: describeError(err) }, "Falha ao gerar parcela recorrente"),
      );
    }
    return e;
  },

  async update(input: DespesaUpdateInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const before = await db.expense.findFirst({ where: { id: input.id } });
    if (!before) throw new NotFoundError("Despesa não encontrada");
    const categoryId = await assertCategory(db, input.categoryId);
    const e = await db.expense.update({
      where: { id: input.id },
      data: {
        description: input.description,
        amount: input.amount,
        type: input.type,
        status: input.status,
        categoryId,
        paymentMethod: input.paymentMethod ?? null,
        recurring: input.recurring ?? false,
        dueDate: toDate(input.dueDate),
        paidDate: toDate(input.paidDate),
      },
    });
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "UPDATE",
      entity: "Expense",
      entityId: e.id,
      oldData: before,
      newData: e,
      ip: ctx.ip,
    });
    // Quitar pela tela de edição também precisa disparar a próxima parcela.
    if (before.status !== "PAGO" && e.status === "PAGO" && e.recurring) {
      await this.gerarProximaParcela(e, ctx).catch((err) =>
        logger.error({ err: describeError(err) }, "Falha ao gerar parcela recorrente"),
      );
    }
    return e;
  },

  /**
   * Marcar como pago em um toque, direto da lista.
   *
   * Era o caminho mais comum do módulo e exigia abrir o formulário de edição,
   * conferir seis campos e salvar — no celular, com pressa, no balcão.
   */
  async marcarComoPago(input: MarcarPagoInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const before = await db.expense.findFirst({ where: { id: input.id } });
    if (!before) throw new NotFoundError("Despesa não encontrada");
    if (before.status === "PAGO") {
      throw new BusinessRuleError("Esta despesa já está paga.");
    }

    const paidDate = toDate(input.paidDate) ?? startOfDayTz(new Date());
    // A baixa é condicional ao status: a checagem acima é só a mensagem rápida.
    // Dois aparelhos (ou duas abas) quitando juntos passavam os dois por ela,
    // e cada um gravava o seu "pago" e a sua auditoria. Aqui só um vence; o
    // outro recebe a mesma recusa de quem chegou depois.
    const e = await db.$transaction(async (tx) => {
      const { count } = await tx.expense.updateMany({
        where: { id: input.id, status: { not: "PAGO" } },
        data: {
          status: "PAGO",
          paidDate,
          paymentMethod: input.paymentMethod ?? before.paymentMethod,
        },
      });
      if (count === 0) throw new BusinessRuleError("Esta despesa já está paga.");
      const paga = await tx.expense.findFirstOrThrow({ where: { id: input.id } });
      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "UPDATE",
          entity: "Expense",
          entityId: paga.id,
          oldData: { status: before.status, paidDate: before.paidDate },
          newData: { status: paga.status, paidDate: paga.paidDate },
          ip: ctx.ip,
        },
        tx,
      );
      return paga;
    });

    if (e.recurring) {
      await this.gerarProximaParcela(e, ctx).catch((err) =>
        logger.error({ err: describeError(err) }, "Falha ao gerar parcela recorrente"),
      );
    }
    return e;
  },

  /** Volta uma despesa para pendente — corrige um "pago" tocado por engano. */
  async marcarComoPendente(id: string, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const before = await db.expense.findFirst({ where: { id } });
    if (!before) throw new NotFoundError("Despesa não encontrada");
    if (before.status !== "PAGO") {
      throw new BusinessRuleError("Esta despesa já está pendente.");
    }
    const e = await db.expense.update({
      where: { id },
      data: { status: "PENDENTE", paidDate: null },
    });
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "UPDATE",
      entity: "Expense",
      entityId: e.id,
      oldData: { status: before.status, paidDate: before.paidDate },
      newData: { status: e.status, paidDate: null },
      ip: ctx.ip,
    });
    return e;
  },

  async remove(id: string, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const before = await db.expense.findFirst({ where: { id } });
    if (!before) throw new NotFoundError("Despesa não encontrada");
    await db.expense.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "DELETE",
      entity: "Expense",
      entityId: id,
      oldData: before,
      ip: ctx.ip,
    });
  },

  // ─────────────────────── Recorrência e cópia ───────────────────────

  /**
   * Gera a parcela do mês seguinte de uma conta recorrente.
   *
   * A marca `recurring` ANDA para a nova parcela e sai da antiga: assim existe
   * exatamente um gerador ativo por conta fixa. É isso que faz a operação ser
   * idempotente — reexecutar não acha mais nada para gerar. Duas execuções
   * simultâneas são resolvidas pela reivindicação atômica da marca (ver abaixo);
   * o `parentId` fica como segunda checagem, para origem que já tenha filho.
   *
   * Sem `dueDate` não há como saber para qual mês copiar; nesse caso a marca é
   * retirada, para não ficar prometendo algo que nunca acontece.
   */
  async gerarProximaParcela(origem: Pick<Expense, "id">, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);

    return db.$transaction(async (tx) => {
      // A origem é REIVINDICADA antes de qualquer outra coisa: tirar a marca é
      // um update condicional, e só uma execução o vence. Era um "procura
      // filho, depois cria" sem trava — o cron das 13:30 e o dono tocando
      // "Pagar" no mesmo instante (ou uma entrega dupla do cron) passavam os
      // dois pela procura, criavam dois filhos com `recurring: true`, e cada
      // um gerava o próprio filho dali em diante: o aluguel em dobro todo mês,
      // para sempre. Aqui a segunda execução bloqueia na linha até a primeira
      // commitar, reavalia o `recurring: true` e sai com count 0.
      const { count } = await tx.expense.updateMany({
        where: { id: origem.id, recurring: true },
        data: { recurring: false },
      });
      if (count === 0) return null;

      // Lida DEPOIS da reivindicação: o objeto recebido pode estar velho
      // (valor ou vencimento editados entre a leitura do cron e agora).
      const atual = await tx.expense.findFirst({ where: { id: origem.id } });
      // Sem vencimento não há mês seguinte: a marca já saiu acima.
      if (!atual?.dueDate) return null;

      const jaGerada = await tx.expense.findFirst({
        where: { parentId: atual.id },
        select: { id: true },
      });
      if (jaGerada) return null;

      const proxima = await tx.expense.create({
        data: {
          tenantId: ctx.tenantId,
          description: atual.description,
          amount: atual.amount,
          type: atual.type,
          status: "PENDENTE",
          categoryId: atual.categoryId,
          paymentMethod: atual.paymentMethod,
          dueDate: proximoVencimento(atual.dueDate),
          paidDate: null,
          recurring: true,
          parentId: atual.id,
        },
      });

      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "CREATE",
          entity: "Expense",
          entityId: proxima.id,
          newData: {
            origem: atual.id,
            description: proxima.description,
            dueDate: proxima.dueDate,
            motivo: "recorrencia_mensal",
          },
          ip: ctx.ip,
        },
        tx,
      );
      return proxima;
    });
  },

  /**
   * Gera as parcelas recorrentes cujo vencimento já chegou.
   *
   * Roda no cron: quem esquece de dar baixa no aluguel não deveria perder a
   * conta do mês seguinte. Antes do vencimento não há nada a antecipar.
   */
  async gerarRecorrentes(ctx: TenantCtx, agora = new Date()) {
    const db = getTenantPrisma(ctx.tenantId);
    const candidatas = await db.expense.findMany({
      where: { recurring: true, dueDate: { not: null, lte: endOfDayTz(agora) } },
      orderBy: { dueDate: "asc" },
      take: 200,
    });
    let geradas = 0;
    for (const c of candidatas) {
      const nova = await this.gerarProximaParcela(c, ctx);
      if (nova) geradas++;
    }
    return { candidatas: candidatas.length, geradas };
  },

  /**
   * Copia para o mês seguinte as despesas de um mês, para quem prefere controle
   * manual à recorrência automática.
   *
   * Só copia o que ainda não tem cópia (`parentId`), então tocar duas vezes não
   * duplica o aluguel. As cópias nascem PENDENTES e sem `recurring`: replicar é
   * uma decisão daquele mês, não uma assinatura.
   */
  async replicarMes(origemRef: string | undefined, ctx: TenantCtx, agora = new Date()) {
    const db = getTenantPrisma(ctx.tenantId);
    const referencia = origemRef ?? mesAnterior(refMes(agora));
    const mes = limitesDoMes(referencia, agora);

    const origem = await db.expense.findMany({
      where: { dueDate: { gte: mes.inicio, lte: mes.fim } },
      orderBy: { dueDate: "asc" },
    });
    if (origem.length === 0) {
      throw new BusinessRuleError(
        `Não há despesas com vencimento em ${referencia} para replicar.`,
      );
    }

    const jaCopiadas = await db.expense.findMany({
      where: { parentId: { in: origem.map((o) => o.id) } },
      select: { parentId: true },
    });
    const copiados = new Set(jaCopiadas.map((c) => c.parentId));

    // Conta marcada "Repetir todo mês" NÃO entra: ela gera a própria parcela
    // seguinte ao ser quitada. Copiá-la fazia duas coisas ruins de uma vez —
    // duas contas iguais no mês seguinte (a cópia e a parcela), e a morte
    // silenciosa da recorrência: `gerarProximaParcela` usa a presença de um
    // filho com `parentId` como marca de "já gerei", encontrava a CÓPIA,
    // concluía que o trabalho estava feito e apagava o `recurring` da origem.
    // O aluguel do box parava de aparecer para sempre, sem erro e sem aviso.
    const pendentesDeCopia = origem.filter(
      (o) => !copiados.has(o.id) && o.dueDate && !o.recurring,
    );

    // O que ficou de fora, e POR QUÊ — a tela precisa dizer. "Nada a copiar:
    // as 3 conta(s) já foram replicadas" era falso quando as 3 eram
    // recorrentes ainda pendentes: não existia cópia nenhuma, e o dono
    // concluía que o mês seguinte já estava lançado.
    const jaCopiadasCount = origem.filter((o) => copiados.has(o.id)).length;
    const recorrentes = origem.filter((o) => !copiados.has(o.id) && o.recurring).length;

    let criadas = 0;
    for (const o of pendentesDeCopia) {
      await db.expense.create({
        data: {
          tenantId: ctx.tenantId,
          description: o.description,
          amount: o.amount,
          type: o.type,
          status: "PENDENTE",
          categoryId: o.categoryId,
          paymentMethod: o.paymentMethod,
          dueDate: proximoVencimento(o.dueDate!),
          recurring: false,
          parentId: o.id,
        },
      });
      criadas++;
    }

    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "CREATE",
      entity: "Expense",
      entityId: null,
      newData: { motivo: "replicar_mes", origem: referencia, criadas },
      ip: ctx.ip,
    });
    return {
      origem: referencia,
      encontradas: origem.length,
      criadas,
      jaCopiadas: jaCopiadasCount,
      recorrentes,
    };
  },

  /**
   * Dados de uma despesa prontos para preencher o formulário de uma nova.
   *
   * Duplicar NÃO grava sozinho: abre o formulário preenchido. Uma conta de luz
   * muda de valor todo mês, e criar direto obrigaria a editar em seguida. O
   * vencimento já vem no mês seguinte, que é o caso real de uso.
   */
  async dadosParaDuplicar(tenantId: string, id: string) {
    const db = getTenantPrisma(tenantId);
    const base =
      id === "ultima"
        ? await db.expense.findFirst({ orderBy: { createdAt: "desc" } })
        : await db.expense.findFirst({ where: { id } });
    if (!base) throw new NotFoundError("Despesa não encontrada");

    return {
      description: base.description,
      amount: Number(base.amount),
      type: base.type,
      status: "PENDENTE" as const,
      categoryId: base.categoryId ?? null,
      paymentMethod: base.paymentMethod ?? null,
      dueDate: base.dueDate ? isoDateTz(proximoVencimento(base.dueDate)) : null,
      paidDate: null,
      recurring: false,
    };
  },

  /**
   * Lança o frete de uma compra como despesa operacional.
   *
   * Frete é a despesa mais recorrente do CEASA e vivia fora do módulo: quem
   * queria vê-la no fluxo de caixa lançava à mão, e às vezes duas vezes. O
   * vínculo `purchaseId` é o que garante uma despesa por compra.
   */
  async lancarFreteDaCompra(
    args: {
      purchaseId: string;
      amount: Prisma.Decimal | number;
      purchaseDate: Date;
      supplierName?: string | null;
    },
    ctx: TenantCtx,
  ) {
    if (toDecimal(args.amount).lessThanOrEqualTo(0)) return null;
    const db = getTenantPrisma(ctx.tenantId);

    const existente = await db.expense.findFirst({
      where: { purchaseId: args.purchaseId },
      select: { id: true },
    });
    if (existente) return null;

    // Usa a categoria "Frete" se a empresa tiver criado; sem ela, fica sem
    // categoria em vez de inventar uma pelas costas do usuário.
    const categoria = await db.expenseCategory.findFirst({ where: { name: "Frete" } });
    const e = await db.expense.create({
      data: {
        tenantId: ctx.tenantId,
        description: args.supplierName
          ? `Frete da compra — ${args.supplierName}`
          : "Frete da compra",
        amount: args.amount,
        type: "VARIAVEL",
        status: "PENDENTE",
        categoryId: categoria?.id ?? null,
        dueDate: args.purchaseDate,
        purchaseId: args.purchaseId,
      },
    });
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "CREATE",
      entity: "Expense",
      entityId: e.id,
      newData: {
        motivo: "frete_compra",
        purchaseId: args.purchaseId,
        amount: e.amount.toString(),
      },
      ip: ctx.ip,
    });
    return e;
  },
};

/**
 * Gera as parcelas recorrentes de TODAS as empresas (cron da plataforma).
 *
 * Usa o `prisma` cru só para descobrir quais empresas têm conta recorrente
 * vencida — varrer a base inteira para não gerar nada seria custo puro. A
 * geração em si passa por `DespesasService`, com o tenant escopado.
 */
export async function gerarRecorrentesDeTodosOsTenants(agora = new Date()) {
  const limite = endOfDayTz(agora);
  const comRecorrencia = await prisma.expense.findMany({
    where: {
      recurring: true,
      deletedAt: null,
      dueDate: { not: null, lte: limite },
      // Empresa excluída ou bloqueada não recebe parcela nova.
      //
      // Faltava: o super-admin excluía a empresa (soft delete + BLOCKED) e o
      // cron diário continuava criando a conta do mês para ela, indefinidamente
      // — engordando a tabela e sujando qualquer relatório de plataforma. O
      // `push-avisos.service` e o `billing.service` já filtravam assim; só este
      // não.
      tenant: { deletedAt: null, status: "ACTIVE" },
    },
    distinct: ["tenantId"],
    select: { tenantId: true },
  });

  let geradas = 0;
  for (const { tenantId } of comRecorrencia) {
    try {
      // Contexto de sistema: a auditoria registra a ação sem usuário, como o
      // billing já faz para o que o cron executa.
      const ctx = {
        tenantId,
        userId: null,
        ip: null,
        session: { email: "cron@ceasapro" },
      } as unknown as TenantCtx;
      const r = await DespesasService.gerarRecorrentes(ctx, agora);
      geradas += r.geradas;
    } catch (e) {
      // Uma empresa com problema não pode parar as outras.
      logger.error({ err: describeError(e), tenantId }, "Falha ao gerar despesas recorrentes");
    }
  }
  return { empresas: comRecorrencia.length, geradas };
}
