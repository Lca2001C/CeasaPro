import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { audit } from "@/lib/audit";
import { FinancialCalc } from "./financial-calc.service";
import { money, toDecimal } from "@/lib/money";
import { NotFoundError, BusinessRuleError, ForbiddenError } from "@/lib/http/app-error";
import {
  dentroDoPrazoDeDesfazer,
  foraDoPrazoDeDesfazer,
  podeDesfazer,
} from "@/lib/desfazer/prazo";
import { DEFAULT_PACKAGING_TYPES, TIPO_CAIXA_PLASTICA } from "@/lib/constants";
import { CaixasService } from "./caixas.service";
import type { Prisma } from "@prisma/client";
import type {
  BaixaEmbalagemInput,
  TipoEmbalagemInput,
  VendaEmbalagemInput,
} from "@/lib/validations/embalagem";
import {
  ORIGEM_BAIXA_EMBALAGEM,
  ORIGEM_BAIXA_EMBALAGEM_DESFEITA,
  ORIGEM_TRANSFERIDO_PARA_CAIXAS,
} from "@/lib/estoque/origens";
import { comIdempotencia } from "@/lib/http/idempotencia";
import type { TenantCtx } from "@/lib/http/with-action";
import { isoDateTz, parseFormDateTz, startOfMonthTz, startOfNextMonthTz } from "@/lib/tz";

/**
 * O tipo de embalagem que É a caixa plástica não tem estoque próprio: lê e
 * grava no livro-razão de caixas (`PackagingType.caixaPlastica`).
 */
const MSG_USE_CAIXAS =
  "A caixa plástica usa o mesmo estoque das caixas. Registre a perda em Caixas → Registrar perda.";

/** `sourceType` da baixa de estoque gerada pela venda e do estorno dela. */
const ORIGEM_VENDA_EMBALAGEM = "PACKAGING_SALE";
const ORIGEM_VENDA_EMBALAGEM_CANCELADA = "PACKAGING_SALE_CANCELLED";
/** Estorno da ENTRADA desfeita (até 24 h). `sourceId` = id da entrada. */
const ORIGEM_ENTRADA_DESFEITA = "PACKAGING_ENTRY_CANCELLED";

/**
 * Custo médio a partir do livro-razão do tipo, sem as entradas desfeitas: a
 * entrada e o estorno dela saem JUNTOS (o custo digitado errado não fica na
 * média; o par soma zero no saldo) — a mesma regra da compra cancelada.
 */
function custoMedioDoTipo(
  movimentos: {
    id: string;
    type: string;
    quantity: number;
    unitCost: Prisma.Decimal | null;
    sourceType: string | null;
    sourceId: string | null;
  }[],
) {
  // A baixa desfeita também sai em par: o estorno é um AJUSTE positivo, que o
  // repasse leria como entrada pelo custo da baixa.
  const ehEstorno = (m: { sourceType: string | null }) =>
    m.sourceType === ORIGEM_ENTRADA_DESFEITA || m.sourceType === ORIGEM_BAIXA_EMBALAGEM_DESFEITA;
  const desfeitas = new Set(movimentos.filter(ehEstorno).map((m) => m.sourceId));
  return FinancialCalc.custoMedioMovel(
    movimentos
      .filter((m) => !ehEstorno(m) && !desfeitas.has(m.id))
      .map((m) => ({
        entrada: (m.type === "ENTRADA" || m.type === "AJUSTE") && m.quantity > 0,
        quantidade: m.quantity,
        custoUnitario: m.unitCost,
      })),
  );
}

/**
 * `SELECT … FOR UPDATE` no tipo: serializa entrada, venda, baixa e desfazer do
 * mesmo tipo, para o livro-razão ser gravado na ordem em que foi lido.
 */
async function travarTipo(
  tx: { $queryRaw: Prisma.TransactionClient["$queryRaw"] },
  packagingTypeId: string,
  tenantId: string,
) {
  const travado = await tx.$queryRaw<
    { id: string; name: string; tracksStock: boolean; caixaPlastica: boolean }[]
  >`
    SELECT id, name, "tracksStock", "caixaPlastica" FROM packaging_types
    WHERE id = ${packagingTypeId} AND "tenantId" = ${tenantId}
      AND "deletedAt" IS NULL
    FOR UPDATE
  `;
  const tipo = travado[0];
  if (!tipo) throw new NotFoundError("Tipo de embalagem não encontrado");
  return tipo;
}

type DbClient = { packagingType: Pick<Prisma.PackagingTypeDelegate, "createMany"> };

/** Cria os tipos de embalagem padrão para um tenant (idempotente). */
export async function createDefaultPackagingTypes(
  tenantId: string,
  db: DbClient = prisma,
) {
  // A "Caixa plástica" padrão nasce vinculada ao estoque de caixas.
  const data: Prisma.PackagingTypeCreateManyInput[] = DEFAULT_PACKAGING_TYPES.map(
    (name) => ({ tenantId, name, caixaPlastica: name === TIPO_CAIXA_PLASTICA }),
  );
  await db.packagingType.createMany({ data, skipDuplicates: true });
}

/** Saldo de um tipo de embalagem — derivado, nunca guardado. */
export interface SaldoEmbalagem {
  packagingTypeId: string;
  saldo: number;
}

export const EmbalagensService = {
  async listTypes(tenantId: string) {
    const db = getTenantPrisma(tenantId);
    return db.packagingType.findMany({ orderBy: { name: "asc" } });
  },

  /**
   * Saldo por tipo, calculado do livro-razão:
   * `Σ(ENTRADA, AJUSTE) − Σ(SAIDA, QUEBRA)`.
   *
   * Mesma fórmula do estoque de produtos. Tipos sem `tracksStock` simplesmente
   * não têm movimento e ficam fora do mapa — quem consulta trata como
   * "não controlado", não como zero.
   */
  async saldos(tenantId: string): Promise<Map<string, number>> {
    // `::bigint`, não `::int`: cada movimento cabe no Int da coluna, mas a SOMA
    // não precisa caber — duas entradas de 1,5 bilhão (valor colado, dedo
    // gordo) faziam o cast levantar "integer out of range", e daí em diante
    // `saldos()` falhava sempre: /embalagens em 500 e toda venda de tipo
    // controlado em "erro inesperado", até alguém mexer no banco.
    const [rows, vinculado] = await Promise.all([
      prisma.$queryRaw<{ packagingTypeId: string; saldo: bigint }[]>`
        SELECT "packagingTypeId",
               COALESCE(SUM(
                 CASE WHEN type::text IN ('ENTRADA', 'AJUSTE') THEN quantity ELSE -quantity END
               ), 0)::bigint AS saldo
        FROM packaging_movements
        WHERE "tenantId" = ${tenantId}
        GROUP BY "packagingTypeId"
      `,
      this.tipoCaixaPlastica(tenantId),
    ]);
    const mapa = new Map(rows.map((r) => [r.packagingTypeId, Number(r.saldo)]));
    // A caixa plástica não tem estoque próprio: o saldo dela é o das caixas
    // LIMPAS — as que podem sair, emprestadas ou vendidas.
    if (vinculado) mapa.set(vinculado.id, (await CaixasService.getSaldo(tenantId)).limpas);
    return mapa;
  },

  /**
   * Passa para as caixas o estoque que o tipo vinculado tinha em
   * `packaging_movements`, de antes do vínculo (empresa que tinha ligado o
   * controle de estoque da "Caixa plástica").
   *
   * Nenhum livro-razão é apagado: entra uma ENTRADA limpa nas caixas, pelo
   * custo médio do tipo, e um AJUSTE negativo zera o tipo, ligado a ela
   * (`sourceType = PACKAGING_TO_CRATES`). Sem conta: a compra dessas
   * embalagens já foi paga e lançada quando entraram. Idempotente — o AJUSTE
   * é a marca de que já foi feito. Rodado por `scripts/vincular-caixas-embalagens.ts`.
   *
   * @returns quantas caixas foram transferidas.
   */
  async transferirSaldoParaCaixas(tenantId: string): Promise<number> {
    return prisma.$transaction(async (tx) => {
      const [tipo] = await tx.$queryRaw<{ id: string; name: string }[]>`
        SELECT id, name FROM packaging_types
        WHERE "tenantId" = ${tenantId} AND "caixaPlastica" AND "deletedAt" IS NULL
        FOR UPDATE
      `;
      if (!tipo) return 0;
      const jaFeita = await tx.packagingMovement.findFirst({
        where: { tenantId, packagingTypeId: tipo.id, sourceType: ORIGEM_TRANSFERIDO_PARA_CAIXAS },
        select: { id: true },
      });
      if (jaFeita) return 0;
      const movimentos = await tx.packagingMovement.findMany({
        where: { tenantId, packagingTypeId: tipo.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, type: true, quantity: true, unitCost: true, sourceType: true, sourceId: true },
      });
      const saldo = movimentos.reduce(
        (a, m) => a + (m.type === "ENTRADA" || m.type === "AJUSTE" ? m.quantity : -m.quantity),
        0,
      );
      if (saldo <= 0) return 0;
      const custoMedio = custoMedioDoTipo(movimentos);

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), 1)`;
      const entrada = await tx.plasticCrateMovement.create({
        data: {
          tenantId,
          type: "ENTRADA",
          quantity: saldo,
          dirty: false,
          unitCost: custoMedio,
          notes: "Saldo transferido de Embalagens",
        },
      });
      await tx.packagingMovement.create({
        data: {
          tenantId,
          packagingTypeId: tipo.id,
          type: "AJUSTE",
          quantity: -saldo,
          unitCost: custoMedio,
          reason: "Transferido para o estoque de caixas plásticas",
          sourceType: ORIGEM_TRANSFERIDO_PARA_CAIXAS,
          sourceId: entrada.id,
        },
      });
      await audit(
        {
          tenantId,
          actorEmail: "script:vincular-caixas-embalagens",
          action: "CREATE",
          entity: "PlasticCrateMovement",
          entityId: entrada.id,
          newData: { transferidoDe: tipo.name, quantity: saldo, custoMedio: custoMedio?.toString() ?? null },
        },
        tx,
      );
      return saldo;
    });
  },

  /** O tipo de embalagem vinculado às caixas plásticas, se a empresa tem um. */
  async tipoCaixaPlastica(tenantId: string) {
    return getTenantPrisma(tenantId).packagingType.findFirst({
      where: { caixaPlastica: true },
      select: { id: true, name: true },
    });
  },

  /**
   * Liga o controle de estoque de um tipo, registrando o que existe hoje.
   *
   * É o caminho de entrada do recurso: em vez de ligar tudo de uma vez e
   * mostrar saldo negativo (que seria falta de histórico, não falta de
   * embalagem), o dono informa a quantidade atual e ela vira o AJUSTE inicial.
   */
  async ativarControleEstoque(
    input: { packagingTypeId: string; quantidadeAtual: number; custoUnitario?: number },
    ctx: TenantCtx,
  ) {
    const db = getTenantPrisma(ctx.tenantId);
    const tipo = await db.packagingType.findFirst({ where: { id: input.packagingTypeId } });
    if (!tipo) throw new NotFoundError("Tipo de embalagem não encontrado");
    if (tipo.caixaPlastica) {
      throw new BusinessRuleError(
        "A caixa plástica já usa o estoque das caixas. Registre a entrada de caixas.",
      );
    }
    if (tipo.tracksStock) {
      throw new BusinessRuleError("O controle de estoque deste tipo já está ligado.");
    }

    await db.$transaction(async (tx) => {
      // Condicional: a checagem de `tracksStock` acima foi feita fora da tx.
      // Dois aparelhos ligando o mesmo tipo juntos passavam os dois por ela e
      // gravavam dois AJUSTEs — o saldo nascia em dobro, e toda validação de
      // venda seguinte usava o número errado. Só um vence este update.
      const { count } = await tx.packagingType.updateMany({
        where: { id: tipo.id, tracksStock: false },
        data: { tracksStock: true },
      });
      if (count === 0) {
        throw new BusinessRuleError("O controle de estoque deste tipo já está ligado.");
      }
      if (input.quantidadeAtual > 0) {
        await tx.packagingMovement.create({
          data: {
            tenantId: ctx.tenantId,
            packagingTypeId: tipo.id,
            type: "AJUSTE",
            quantity: input.quantidadeAtual,
            // O custo do saldo inicial forma a média que a venda desconta.
            unitCost: input.custoUnitario ?? null,
            reason: "Saldo inicial ao ligar o controle de estoque",
          },
        });
      }
      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "UPDATE",
          entity: "PackagingType",
          entityId: tipo.id,
          oldData: { tracksStock: false },
          newData: { tracksStock: true, saldoInicial: input.quantidadeAtual },
          ip: ctx.ip,
        },
        tx,
      );
    });
    return { id: tipo.id, name: tipo.name };
  },

  /** Entrada de embalagens: compra ou reposição. */
  async registrarEntrada(
    input: {
      packagingTypeId: string;
      quantity: number;
      unitCost: number;
      notes?: string | null;
      idempotencyKey?: string;
    },
    ctx: TenantCtx,
  ): Promise<{ id: string; quantity: number }> {
    const tipo = await getTenantPrisma(ctx.tenantId).packagingType.findFirst({
      where: { id: input.packagingTypeId },
      select: { caixaPlastica: true },
    });
    if (!tipo) throw new NotFoundError("Tipo de embalagem não encontrado");
    // Caixa plástica entra no estoque das caixas: limpa, com o custo e a conta
    // da compra (`CaixasService.registrar`). A chave de idempotência vale lá.
    if (tipo.caixaPlastica) {
      return CaixasService.registrar(
        {
          type: "ENTRADA",
          quantity: input.quantity,
          unitCost: input.unitCost,
          dirty: false,
          movementDate: isoDateTz(),
          notes: input.notes ?? "Entrada pela aba Embalagens",
          idempotencyKey: input.idempotencyKey,
        },
        ctx,
      );
    }
    return comIdempotencia(
      input.idempotencyKey,
      (k) => getTenantPrisma(ctx.tenantId).packagingMovement.findFirst({ where: { idempotencyKey: k } }),
      () => this.gravarEntrada(input, ctx),
    );
  },

  async gravarEntrada(
    input: {
      packagingTypeId: string;
      quantity: number;
      unitCost: number;
      notes?: string | null;
      idempotencyKey?: string;
    },
    ctx: TenantCtx,
  ) {
    const db = getTenantPrisma(ctx.tenantId);

    // Entrada e conta na MESMA transação (regra 5). A conta é o dinheiro que
    // saiu: sem ela, comprar embalagem não aparecia no caixa nem em "Pagas"; o
    // custo em si entra no lucro pela venda (custo médio), então a conta fica
    // fora do lucro, como a da compra de mercadoria (`ORIGENS_DE_COMPRA`).
    return db.$transaction(async (tx) => {
      // Trava o tipo como a venda e a baixa: sem isso, a entrada inserida e
      // ainda não confirmada ficava com `createdAt` ANTES da venda que corria
      // ao lado, e o repasse do custo médio a contava antes da saída.
      const tipo = await travarTipo(tx, input.packagingTypeId, ctx.tenantId);
      if (tipo.caixaPlastica) {
        // `registrarEntrada` desvia antes; aqui é a barreira de quem chamar direto.
        throw new BusinessRuleError("A entrada de caixa plástica vai para o estoque das caixas.");
      }
      if (!tipo.tracksStock) {
        throw new BusinessRuleError(
          `O controle de estoque de "${tipo.name}" está desligado. Ligue antes de registrar entrada.`,
        );
      }
      const mov = await tx.packagingMovement.create({
        data: {
          tenantId: ctx.tenantId,
          packagingTypeId: tipo.id,
          type: "ENTRADA",
          quantity: input.quantity,
          unitCost: input.unitCost,
          reason: input.notes ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
        },
      });
      const hoje = new Date();
      const conta = await tx.expense.create({
        data: {
          tenantId: ctx.tenantId,
          origem: "COMPRA_EMBALAGEM",
          packagingMovementId: mov.id,
          description: `Compra de embalagem — ${input.quantity} ${tipo.name}`,
          amount: FinancialCalc.valorTotalCompra(input.quantity, input.unitCost),
          type: "VARIAVEL",
          recurring: false,
          status: "PAGO",
          dueDate: hoje,
          paidDate: hoje,
        },
      });
      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "CREATE",
          entity: "PackagingMovement",
          entityId: mov.id,
          newData: {
            tipo: tipo.name,
            quantity: input.quantity,
            unitCost: input.unitCost,
            conta: conta.id,
          },
          ip: ctx.ip,
        },
        tx,
      );
      return mov;
    });
  },

  /**
   * Baixa de embalagem que saiu SEM ser vendida — rasgou, molhou, foi junto com
   * a mercadoria. Não existia: o custo dessas caixas, cuja compra fica fora do
   * lucro (`COMPRA_EMBALAGEM`, "o custo entra pela venda"), nunca chegava ao
   * resultado, e o saldo ficava com embalagem que não existe. Sai pelo custo
   * médio do tipo (QUEBRA, que não muda a média) e soma no "Custo das
   * embalagens" do mês (`dashboard.service.ts`).
   */
  async registrarBaixa(input: BaixaEmbalagemInput, ctx: TenantCtx) {
    // Timeout depois do commit e o dono toca de novo: sem a chave, a baixa
    // entrava duas vezes (saldo e custo do mês em dobro).
    return comIdempotencia(
      input.idempotencyKey,
      (k) => getTenantPrisma(ctx.tenantId).packagingMovement.findFirst({ where: { idempotencyKey: k } }),
      () => this.gravarBaixa(input, ctx),
    );
  },

  async gravarBaixa(input: BaixaEmbalagemInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    return db.$transaction(async (tx) => {
      const tipo = await travarTipo(tx, input.packagingTypeId, ctx.tenantId);
      // A perda de caixa plástica precisa dizer de qual pote saiu (limpa,
      // suja, com cliente) — quem sabe isso é o "Registrar perda" das caixas.
      if (tipo.caixaPlastica) throw new BusinessRuleError(MSG_USE_CAIXAS);
      if (!tipo.tracksStock) {
        throw new BusinessRuleError(
          `O controle de estoque de "${tipo.name}" está desligado — não há saldo para baixar.`,
        );
      }
      const movimentos = await tx.packagingMovement.findMany({
        where: { packagingTypeId: input.packagingTypeId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, type: true, quantity: true, unitCost: true, sourceType: true, sourceId: true },
      });
      const saldo = movimentos.reduce(
        (a, m) => a + (m.type === "ENTRADA" || m.type === "AJUSTE" ? m.quantity : -m.quantity),
        0,
      );
      if (input.quantity > saldo) {
        throw new BusinessRuleError(
          `Há ${saldo} ${tipo.name} em estoque — não dá para baixar ${input.quantity}.`,
        );
      }
      const custoMedio = custoMedioDoTipo(movimentos);
      const mov = await tx.packagingMovement.create({
        data: {
          tenantId: ctx.tenantId,
          packagingTypeId: input.packagingTypeId,
          type: "QUEBRA",
          quantity: input.quantity,
          unitCost: custoMedio,
          reason: input.motivo,
          sourceType: ORIGEM_BAIXA_EMBALAGEM,
          idempotencyKey: input.idempotencyKey ?? null,
        },
      });
      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "CREATE",
          entity: "PackagingMovement",
          entityId: mov.id,
          newData: {
            baixa: true,
            tipo: tipo.name,
            quantity: input.quantity,
            custoMedio: custoMedio?.toString() ?? null,
            motivo: input.motivo,
          },
          ip: ctx.ip,
        },
        tx,
      );
      return mov;
    });
  },

  /**
   * Desfaz a baixa lançada errada — até 24 h, só o dono (regra única de
   * desfazer, §3.13). Entra um AJUSTE espelhado; a baixa e o estorno saem do
   * custo médio e do custo das embalagens do mês. Recusa se o tipo teve
   * movimento depois: a venda seguinte já gravou o custo com aquele saldo.
   */
  async desfazerBaixa(input: { id: string }, ctx: TenantCtx) {
    if (!podeDesfazer(ctx.session.role)) {
      throw new ForbiddenError("Só o responsável pela empresa pode desfazer uma baixa.");
    }
    const db = getTenantPrisma(ctx.tenantId);
    return db.$transaction(async (tx) => {
      const baixa = await tx.packagingMovement.findFirst({
        where: { id: input.id, type: "QUEBRA", sourceType: ORIGEM_BAIXA_EMBALAGEM },
      });
      if (!baixa) throw new NotFoundError("Baixa não encontrada");
      if (!dentroDoPrazoDeDesfazer(baixa.createdAt)) {
        throw new BusinessRuleError(foraDoPrazoDeDesfazer("desfazer esta baixa"));
      }
      await travarTipo(tx, baixa.packagingTypeId, ctx.tenantId);
      const jaDesfeita = await tx.packagingMovement.findFirst({
        where: { sourceType: ORIGEM_BAIXA_EMBALAGEM_DESFEITA, sourceId: baixa.id },
        select: { id: true },
      });
      if (jaDesfeita) throw new BusinessRuleError("Esta baixa já foi desfeita.");
      const depois = await tx.packagingMovement.count({
        where: {
          packagingTypeId: baixa.packagingTypeId,
          OR: [
            { createdAt: { gt: baixa.createdAt } },
            { createdAt: baixa.createdAt, id: { gt: baixa.id } },
          ],
        },
      });
      if (depois > 0) {
        throw new BusinessRuleError(
          "Já houve venda, entrada ou outra baixa deste tipo depois desta. Não dá para desfazer.",
        );
      }
      await tx.packagingMovement.create({
        data: {
          tenantId: ctx.tenantId,
          packagingTypeId: baixa.packagingTypeId,
          type: "AJUSTE",
          quantity: baixa.quantity,
          unitCost: baixa.unitCost,
          // Na data da baixa: o par se anula no mesmo mês.
          movedAt: baixa.movedAt,
          reason: "Baixa desfeita",
          sourceType: ORIGEM_BAIXA_EMBALAGEM_DESFEITA,
          sourceId: baixa.id,
        },
      });
      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "UPDATE",
          entity: "PackagingMovement",
          entityId: baixa.id,
          oldData: { quantity: baixa.quantity, motivo: baixa.reason },
          newData: { desfeita: true },
          ip: ctx.ip,
        },
        tx,
      );
      return { id: baixa.id };
    });
  },

  /**
   * Desfaz a entrada de embalagem lançada errada — até 24 h, só o dono (regra
   * única de desfazer). Entra um AJUSTE espelhado; a entrada e o estorno saem
   * do custo médio (`custoMedioDoTipo`), e a conta da compra é cancelada.
   * Recusa se o tipo teve movimento depois (a venda já gravou o custo dela).
   */
  async desfazerEntrada(input: { id: string }, ctx: TenantCtx) {
    if (!podeDesfazer(ctx.session.role)) {
      throw new ForbiddenError("Só o responsável pela empresa pode desfazer uma entrada.");
    }
    const db = getTenantPrisma(ctx.tenantId);
    const desfeita = await db.$transaction(async (tx) => {
      const entrada = await tx.packagingMovement.findFirst({
        where: { id: input.id, type: "ENTRADA", sourceType: null },
      });
      if (!entrada) return null;
      if (!dentroDoPrazoDeDesfazer(entrada.createdAt)) {
        throw new BusinessRuleError(foraDoPrazoDeDesfazer("desfazer esta entrada"));
      }
      await tx.$queryRaw`
        SELECT id FROM packaging_types
        WHERE id = ${entrada.packagingTypeId} AND "tenantId" = ${ctx.tenantId}
        FOR UPDATE
      `;
      const jaDesfeita = await tx.packagingMovement.findFirst({
        where: { sourceType: ORIGEM_ENTRADA_DESFEITA, sourceId: entrada.id },
        select: { id: true },
      });
      if (jaDesfeita) throw new BusinessRuleError("Esta entrada já foi desfeita.");
      const depois = await tx.packagingMovement.count({
        where: {
          packagingTypeId: entrada.packagingTypeId,
          OR: [
            { createdAt: { gt: entrada.createdAt } },
            { createdAt: entrada.createdAt, id: { gt: entrada.id } },
          ],
        },
      });
      if (depois > 0) {
        throw new BusinessRuleError(
          "Já houve venda ou outra entrada deste tipo depois desta. Não dá para desfazer.",
        );
      }
      await tx.packagingMovement.create({
        data: {
          tenantId: ctx.tenantId,
          packagingTypeId: entrada.packagingTypeId,
          type: "AJUSTE",
          quantity: -entrada.quantity,
          unitCost: entrada.unitCost,
          reason: "Entrada desfeita",
          sourceType: ORIGEM_ENTRADA_DESFEITA,
          sourceId: entrada.id,
        },
      });
      await tx.expense.updateMany({
        where: { packagingMovementId: entrada.id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "UPDATE",
          entity: "PackagingMovement",
          entityId: entrada.id,
          oldData: { quantity: entrada.quantity },
          newData: { desfeita: true },
          ip: ctx.ip,
        },
        tx,
      );
      return { id: entrada.id };
    });
    // Não é entrada de embalagem: a da caixa plástica foi gravada no estoque
    // das caixas (`registrarEntrada`), e é lá que se desfaz.
    return desfeita ?? CaixasService.desfazerEntrada(input, ctx);
  },

  /**
   * Cria o tipo — ou RESSUSCITA o que foi excluído com o mesmo nome.
   *
   * `PackagingType` tem a mesma combinação que derrubava a categoria de despesa:
   * `@@unique([tenantId, name])` mais `deletedAt`. A linha excluída continua
   * ocupando o nome, o client escopado não a enxerga (injeta `deletedAt: null`)
   * e o `create` estoura P2002 — que chega à tela como "erro inesperado".
   */
  async createType(input: TipoEmbalagemInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const exists = await db.packagingType.findFirst({ where: { name: input.name } });
    if (exists) throw new BusinessRuleError("Já existe um tipo com esse nome");

    const excluido = await prisma.packagingType.findFirst({
      where: { tenantId: ctx.tenantId, name: input.name, deletedAt: { not: null } },
    });
    if (excluido) {
      return prisma.packagingType.update({
        where: { id: excluido.id },
        data: { deletedAt: null },
      });
    }

    return db.packagingType.create({
      data: { tenantId: ctx.tenantId, name: input.name },
    });
  },

  /**
   * As vendas recentes (lista) e os totais do MÊS corrente (cards).
   *
   * Os totais eram somados sobre as 100 linhas da lista: passada a centésima
   * venda, "Total vendido" virava a soma de uma janela móvel, sem período no
   * rótulo — e podia até CAIR quando entrava uma venda pequena e saía uma
   * grande. Agora é o banco que soma, recortado no mês (fuso do app), e a tela
   * diz de qual mês fala. O `take: 100` ficou só para a lista.
   */
  async listSales(tenantId: string, agora = new Date()) {
    const db = getTenantPrisma(tenantId);
    const [vendas, doMes] = await Promise.all([
      db.packagingSale.findMany({
        include: { type: true },
        orderBy: { saleDate: "desc" },
        take: 100,
      }),
      db.packagingSale.aggregate({
        _sum: { totalAmount: true, quantity: true },
        // Cancelada fica na lista (riscada) e fora dos totais.
        where: {
          saleDate: { gte: startOfMonthTz(agora), lt: startOfNextMonthTz(agora) },
          cancelledAt: null,
        },
      }),
    ]);
    const total = money(toDecimal(doMes._sum.totalAmount ?? 0));
    const totalQtd = doMes._sum.quantity ?? 0;
    return {
      vendas: vendas.map((v) => ({ ...v, podeCancelar: this.podeCancelar(v, agora) })),
      total,
      totalQtd,
    };
  },

  async createSale(input: VendaEmbalagemInput, ctx: TenantCtx) {
    return comIdempotencia(
      input.idempotencyKey,
      (k) => getTenantPrisma(ctx.tenantId).packagingSale.findFirst({ where: { idempotencyKey: k } }),
      () => this.gravarVenda(input, ctx),
    );
  },

  async gravarVenda(input: VendaEmbalagemInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const tipo = await db.packagingType.findFirst({ where: { id: input.packagingTypeId } });
    if (!tipo) throw new NotFoundError("Tipo de embalagem não encontrado");

    const totalAmount = FinancialCalc.valorTotalVenda(input.quantity, input.unitPrice);

    // Venda e baixa na MESMA transação: uma sem a outra deixaria o saldo
    // mentindo até alguém conferir na mão.
    const venda = await db.$transaction(async (tx) => {
      // Trava a linha do tipo ANTES de ler o saldo, e lê o saldo DENTRO da tx.
      // O saldo era lido fora dela, sem trava: dois aparelhos vendendo as 10
      // últimas caixas ao mesmo tempo passavam os dois pela validação e o saldo
      // ia a -10 — exatamente o que ela existe para impedir. A granularidade é
      // o tipo (o saldo é por tipo), então travar a linha dele basta; o
      // segundo vendedor espera o commit do primeiro e lê o saldo já baixado.
      // `tracksStock` é relido aqui pelo mesmo motivo: ligar o controle ao
      // mesmo tempo que uma venda não pode deixar a venda sem baixa.
      const travado = await travarTipo(tx, tipo.id, ctx.tenantId);
      // Caixa plástica: o estoque é o das caixas limpas. Trava as caixas da
      // empresa e lê o custo médio delas antes da saída; a VENDA, gravada
      // depois da venda, confere as limpas (`assertCrateMovement`) e desfaz
      // tudo se não houver caixa.
      const caixa = travado.caixaPlastica;
      const controla = !caixa && travado.tracksStock;

      // Só valida saldo de quem controla estoque. Tipo sem controle segue como
      // antes: registra a venda e pronto — não inventa saldo negativo.
      let custoMedio: Prisma.Decimal | null = null;
      if (caixa) custoMedio = await CaixasService.custoMedioInTx(tx, ctx.tenantId);
      if (controla) {
        const [linha] = await tx.$queryRaw<{ saldo: bigint }[]>`
          SELECT COALESCE(SUM(
                   CASE WHEN type::text IN ('ENTRADA', 'AJUSTE') THEN quantity ELSE -quantity END
                 ), 0)::bigint AS saldo
          FROM packaging_movements
          WHERE "tenantId" = ${ctx.tenantId} AND "packagingTypeId" = ${tipo.id}
        `;
        const saldo = Number(linha?.saldo ?? 0);
        if (input.quantity > saldo) {
          throw new BusinessRuleError(
            `Você tem ${saldo} ${tipo.name} em estoque e está vendendo ${input.quantity}. ` +
              "Registre a entrada antes ou ajuste a quantidade.",
          );
        }
        // Custo médio ANTES desta saída, lido sob a mesma trava do saldo — a
        // venda leva o custo do que estava na prateleira (como `unitCostAtSale`
        // da mercadoria). Fica gravado: a compra seguinte não reescreve o
        // lucro desta venda.
        const movimentos = await tx.packagingMovement.findMany({
          where: { packagingTypeId: tipo.id },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            type: true,
            quantity: true,
            unitCost: true,
            sourceType: true,
            sourceId: true,
          },
        });
        custoMedio = custoMedioDoTipo(movimentos);
      }

      const criada = await tx.packagingSale.create({
        data: {
          tenantId: ctx.tenantId,
          packagingTypeId: input.packagingTypeId,
          customerName: input.customerName || null,
          saleDate: parseFormDateTz(input.saleDate),
          quantity: input.quantity,
          unitPrice: input.unitPrice,
          totalAmount,
          unitCostAtSale: custoMedio,
          idempotencyKey: input.idempotencyKey ?? null,
        },
      });

      if (controla) {
        await tx.packagingMovement.create({
          data: {
            tenantId: ctx.tenantId,
            packagingTypeId: tipo.id,
            type: "SAIDA",
            quantity: input.quantity,
            movedAt: parseFormDateTz(input.saleDate),
            sourceType: ORIGEM_VENDA_EMBALAGEM,
            sourceId: criada.id,
          },
        });
      }
      if (caixa) {
        await CaixasService.registrarInTx(
          tx,
          {
            type: "VENDA",
            quantity: input.quantity,
            customerName: input.customerName || null,
            movementDate: input.saleDate,
            unitCost: custoMedio,
            notes: "Vendida como embalagem",
            packagingSaleId: criada.id,
          },
          ctx,
        );
      }

      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "CREATE",
          entity: "PackagingSale",
          entityId: criada.id,
          newData: {
            tipo: tipo.name,
            quantity: input.quantity,
            totalAmount: totalAmount.toString(),
            baixouEstoque: controla || caixa,
            estoqueDeCaixas: caixa,
            custoMedio: custoMedio?.toString() ?? null,
          },
          ip: ctx.ip,
        },
        tx,
      );
      return criada;
    });
    return venda;
  },

  /** A venda ainda pode ser cancelada? (A tela usa para mostrar o botão.) */
  podeCancelar(venda: { createdAt: Date; cancelledAt: Date | null }, agora = new Date()) {
    return !venda.cancelledAt && dentroDoPrazoDeDesfazer(venda.createdAt, agora);
  },

  /**
   * Cancela uma venda de embalagem lançada errada — a regra única de desfazer
   * (`src/lib/desfazer/prazo.ts`): até 24 h do registro, só o dono.
   *
   * Antes a venda era APAGADA a qualquer tempo e a baixa de estoque dela
   * também (`deleteMany` no livro-razão): um lançamento de meses atrás sumia e
   * reescrevia o lucro de um mês fechado — agora que a venda carrega custo,
   * reescrevia o custo também. Agora a venda fica marcada (`cancelledAt`), sai
   * dos totais, e a quantidade volta por um AJUSTE de estorno com o custo com
   * que saiu (`unitCostAtSale`) — a média se recompõe, como na venda de
   * mercadoria cancelada.
   */
  async cancelarVenda(input: { id: string; motivo?: string | null }, ctx: TenantCtx) {
    if (!podeDesfazer(ctx.session.role)) {
      throw new ForbiddenError("Só o responsável pela empresa pode cancelar uma venda.");
    }
    const db = getTenantPrisma(ctx.tenantId);
    const venda = await db.packagingSale.findFirst({ where: { id: input.id } });
    if (!venda) throw new NotFoundError("Venda não encontrada");
    if (venda.cancelledAt) throw new BusinessRuleError("Esta venda já foi cancelada.");
    if (!dentroDoPrazoDeDesfazer(venda.createdAt)) {
      throw new BusinessRuleError(foraDoPrazoDeDesfazer("cancelar esta venda"));
    }

    await db.$transaction(async (tx) => {
      // Mesma trava da venda: o estorno entra no saldo do tipo sob a mesma ordem.
      await tx.$queryRaw`
        SELECT id FROM packaging_types
        WHERE id = ${venda.packagingTypeId} AND "tenantId" = ${ctx.tenantId}
        FOR UPDATE
      `;
      const { count } = await tx.packagingSale.updateMany({
        where: { id: venda.id, cancelledAt: null },
        data: { cancelledAt: new Date(), cancelReason: input.motivo || null },
      });
      if (count !== 1) throw new BusinessRuleError("Esta venda já foi cancelada.");

      // Só volta ao estoque o que SAIU dele (tipo sem controle não gerou baixa).
      const baixa = await tx.packagingMovement.findFirst({
        where: { sourceType: ORIGEM_VENDA_EMBALAGEM, sourceId: venda.id, type: "SAIDA" },
      });
      if (baixa) {
        await tx.packagingMovement.create({
          data: {
            tenantId: ctx.tenantId,
            packagingTypeId: venda.packagingTypeId,
            type: "AJUSTE",
            quantity: baixa.quantity,
            unitCost: venda.unitCostAtSale,
            reason: "Estorno de venda cancelada",
            sourceType: ORIGEM_VENDA_EMBALAGEM_CANCELADA,
            sourceId: venda.id,
          },
        });
      }
      // Caixa plástica vendida: volta às limpas pela VENDA espelhada.
      const caixasDevolvidas = await CaixasService.estornarVendaInTx(tx, venda.id, ctx);

      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "UPDATE",
          entity: "PackagingSale",
          entityId: venda.id,
          oldData: { cancelledAt: null },
          newData: {
            cancelada: true,
            motivo: input.motivo ?? null,
            totalAmount: venda.totalAmount.toString(),
            estoqueDevolvido: (baixa?.quantity ?? 0) + caixasDevolvidas,
          },
          ip: ctx.ip,
        },
        tx,
      );
    });
    return { id: venda.id };
  },
};
