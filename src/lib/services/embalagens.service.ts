import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { audit } from "@/lib/audit";
import { FinancialCalc } from "./financial-calc.service";
import { money, toDecimal } from "@/lib/money";
import { NotFoundError, BusinessRuleError } from "@/lib/http/app-error";
import { DEFAULT_PACKAGING_TYPES } from "@/lib/constants";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { TipoEmbalagemInput, VendaEmbalagemInput } from "@/lib/validations/embalagem";
import type { TenantCtx } from "@/lib/http/with-action";
import { parseFormDateTz, startOfMonthTz, startOfNextMonthTz } from "@/lib/tz";

type DbClient = Pick<PrismaClient, "packagingType">;

/** Cria os tipos de embalagem padrão para um tenant (idempotente). */
export async function createDefaultPackagingTypes(
  tenantId: string,
  db: DbClient = prisma,
) {
  const data: Prisma.PackagingTypeCreateManyInput[] = DEFAULT_PACKAGING_TYPES.map(
    (name) => ({ tenantId, name }),
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
    const rows = await prisma.$queryRaw<{ packagingTypeId: string; saldo: bigint }[]>`
      SELECT "packagingTypeId",
             COALESCE(SUM(
               CASE WHEN type::text IN ('ENTRADA', 'AJUSTE') THEN quantity ELSE -quantity END
             ), 0)::bigint AS saldo
      FROM packaging_movements
      WHERE "tenantId" = ${tenantId}
      GROUP BY "packagingTypeId"
    `;
    return new Map(rows.map((r) => [r.packagingTypeId, Number(r.saldo)]));
  },

  /**
   * Liga o controle de estoque de um tipo, registrando o que existe hoje.
   *
   * É o caminho de entrada do recurso: em vez de ligar tudo de uma vez e
   * mostrar saldo negativo (que seria falta de histórico, não falta de
   * embalagem), o dono informa a quantidade atual e ela vira o AJUSTE inicial.
   */
  async ativarControleEstoque(
    input: { packagingTypeId: string; quantidadeAtual: number },
    ctx: TenantCtx,
  ) {
    const db = getTenantPrisma(ctx.tenantId);
    const tipo = await db.packagingType.findFirst({ where: { id: input.packagingTypeId } });
    if (!tipo) throw new NotFoundError("Tipo de embalagem não encontrado");
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
    input: { packagingTypeId: string; quantity: number; unitCost?: number; notes?: string | null },
    ctx: TenantCtx,
  ) {
    const db = getTenantPrisma(ctx.tenantId);
    const tipo = await db.packagingType.findFirst({ where: { id: input.packagingTypeId } });
    if (!tipo) throw new NotFoundError("Tipo de embalagem não encontrado");
    if (!tipo.tracksStock) {
      throw new BusinessRuleError(
        `O controle de estoque de "${tipo.name}" está desligado. Ligue antes de registrar entrada.`,
      );
    }

    const mov = await db.packagingMovement.create({
      data: {
        tenantId: ctx.tenantId,
        packagingTypeId: tipo.id,
        type: "ENTRADA",
        quantity: input.quantity,
        unitCost: input.unitCost ?? null,
        reason: input.notes ?? null,
      },
    });
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "CREATE",
      entity: "PackagingMovement",
      entityId: mov.id,
      newData: { tipo: tipo.name, quantity: input.quantity },
      ip: ctx.ip,
    });
    return mov;
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
        where: { saleDate: { gte: startOfMonthTz(agora), lt: startOfNextMonthTz(agora) } },
      }),
    ]);
    const total = money(toDecimal(doMes._sum.totalAmount ?? 0));
    const totalQtd = doMes._sum.quantity ?? 0;
    return { vendas, total, totalQtd };
  },

  async createSale(input: VendaEmbalagemInput, ctx: TenantCtx) {
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
      const travado = await tx.$queryRaw<{ tracksStock: boolean }[]>`
        SELECT "tracksStock" FROM packaging_types
        WHERE id = ${tipo.id} AND "tenantId" = ${ctx.tenantId}
        FOR UPDATE
      `;
      const controla = travado[0]?.tracksStock ?? false;

      // Só valida saldo de quem controla estoque. Tipo sem controle segue como
      // antes: registra a venda e pronto — não inventa saldo negativo.
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
            sourceType: "PACKAGING_SALE",
            sourceId: criada.id,
          },
        });
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
            baixouEstoque: controla,
          },
          ip: ctx.ip,
        },
        tx,
      );
      return criada;
    });
    return venda;
  },

  async removeSale(id: string, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const before = await db.packagingSale.findFirst({ where: { id } });
    if (!before) throw new NotFoundError("Venda não encontrada");

    await db.$transaction(async (tx) => {
      await tx.packagingSale.update({ where: { id }, data: { deletedAt: new Date() } });

      // A baixa é APAGADA, não compensada: a venda está sendo desfeita, não
      // devolvida. Uma ENTRADA de estorno apareceria no histórico como se
      // embalagem tivesse chegado. Mesmo critério da exclusão de fiado.
      await tx.packagingMovement.deleteMany({
        where: { tenantId: ctx.tenantId, sourceType: "PACKAGING_SALE", sourceId: id },
      });

      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "DELETE",
          entity: "PackagingSale",
          entityId: id,
          oldData: before,
          ip: ctx.ip,
        },
        tx,
      );
    });
  },
};
