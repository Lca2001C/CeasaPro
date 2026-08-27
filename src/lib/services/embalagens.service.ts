import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { audit } from "@/lib/audit";
import { FinancialCalc } from "./financial-calc.service";
import { add, money } from "@/lib/money";
import { NotFoundError, BusinessRuleError } from "@/lib/http/app-error";
import { DEFAULT_PACKAGING_TYPES } from "@/lib/constants";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { TipoEmbalagemInput, VendaEmbalagemInput } from "@/lib/validations/embalagem";
import type { TenantCtx } from "@/lib/http/with-action";

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
    const rows = await prisma.$queryRaw<{ packagingTypeId: string; saldo: number }[]>`
      SELECT "packagingTypeId",
             COALESCE(SUM(
               CASE WHEN type::text IN ('ENTRADA', 'AJUSTE') THEN quantity ELSE -quantity END
             ), 0)::int AS saldo
      FROM packaging_movements
      WHERE "tenantId" = ${tenantId}
      GROUP BY "packagingTypeId"
    `;
    return new Map(rows.map((r) => [r.packagingTypeId, r.saldo]));
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
      await tx.packagingType.update({
        where: { id: tipo.id },
        data: { tracksStock: true },
      });
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

  async createType(input: TipoEmbalagemInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const exists = await db.packagingType.findFirst({ where: { name: input.name } });
    if (exists) throw new BusinessRuleError("Já existe um tipo com esse nome");
    return db.packagingType.create({
      data: { tenantId: ctx.tenantId, name: input.name },
    });
  },

  async listSales(tenantId: string) {
    const db = getTenantPrisma(tenantId);
    const vendas = await db.packagingSale.findMany({
      include: { type: true },
      orderBy: { saleDate: "desc" },
      take: 100,
    });
    const total = money(add(...vendas.map((v) => v.totalAmount)));
    const totalQtd = vendas.reduce((a, v) => a + v.quantity, 0);
    return { vendas, total, totalQtd };
  },

  async createSale(input: VendaEmbalagemInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const tipo = await db.packagingType.findFirst({ where: { id: input.packagingTypeId } });
    if (!tipo) throw new NotFoundError("Tipo de embalagem não encontrado");

    // Só valida saldo de quem controla estoque. Tipo sem controle segue como
    // antes: registra a venda e pronto — não inventa saldo negativo.
    if (tipo.tracksStock) {
      const saldo = (await this.saldos(ctx.tenantId)).get(tipo.id) ?? 0;
      if (input.quantity > saldo) {
        throw new BusinessRuleError(
          `Você tem ${saldo} ${tipo.name} em estoque e está vendendo ${input.quantity}. ` +
            "Registre a entrada antes ou ajuste a quantidade.",
        );
      }
    }

    const totalAmount = FinancialCalc.valorTotalVenda(input.quantity, input.unitPrice);

    // Venda e baixa na MESMA transação: uma sem a outra deixaria o saldo
    // mentindo até alguém conferir na mão.
    const venda = await db.$transaction(async (tx) => {
      const criada = await tx.packagingSale.create({
        data: {
          tenantId: ctx.tenantId,
          packagingTypeId: input.packagingTypeId,
          customerName: input.customerName || null,
          saleDate: new Date(input.saleDate),
          quantity: input.quantity,
          unitPrice: input.unitPrice,
          totalAmount,
        },
      });

      if (tipo.tracksStock) {
        await tx.packagingMovement.create({
          data: {
            tenantId: ctx.tenantId,
            packagingTypeId: tipo.id,
            type: "SAIDA",
            quantity: input.quantity,
            movedAt: new Date(input.saleDate),
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
            baixouEstoque: tipo.tracksStock,
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
