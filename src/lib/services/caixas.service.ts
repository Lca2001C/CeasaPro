import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { audit } from "@/lib/audit";
import { BusinessRuleError } from "@/lib/http/app-error";
import type { CaixaMovimentoInput } from "@/lib/validations/caixa";
import type { TenantCtx } from "@/lib/http/with-action";

export interface CrateSaldo {
  vazias: number; // no estoque
  comClientes: number;
  perdidas: number; // quebradas/sumidas (inclui as que chegaram quebradas)
}

/**
 * Caixas plásticas — livro-razão (append-only). Saldos são DERIVADOS:
 *   vazias      = ENTRADA − SAIDA + RETORNO − QUEBRA(sem cliente)
 *   comClientes = SAIDA − RETORNO − QUEBRA(com cliente)
 *   perdidas    = QUEBRA(todas) + ENTRADA.brokenQty
 * QUEBRA com cliente = caixa perdida/sumida na mão do cliente.
 */
export const CaixasService = {
  async getSaldo(tenantId: string): Promise<CrateSaldo> {
    const rows = await prisma.$queryRaw<
      { type: string; semcliente: number; comcliente: number; broken: number }[]
    >`
      SELECT type::text AS type,
             COALESCE(SUM(CASE WHEN "customerName" IS NULL THEN quantity ELSE 0 END), 0)::int AS semcliente,
             COALESCE(SUM(CASE WHEN "customerName" IS NOT NULL THEN quantity ELSE 0 END), 0)::int AS comcliente,
             COALESCE(SUM("brokenQty"), 0)::int AS broken
      FROM plastic_crate_movements
      WHERE "tenantId" = ${tenantId}
      GROUP BY type
    `;
    const get = (t: string) =>
      rows.find((r) => r.type === t) ?? { semcliente: 0, comcliente: 0, broken: 0 };
    const entrada = get("ENTRADA");
    const saida = get("SAIDA");
    const retorno = get("RETORNO");
    const quebra = get("QUEBRA");

    const entradaTotal = entrada.semcliente + entrada.comcliente;
    const saidaTotal = saida.semcliente + saida.comcliente;
    const retornoTotal = retorno.semcliente + retorno.comcliente;

    return {
      vazias: entradaTotal - saidaTotal + retornoTotal - quebra.semcliente,
      comClientes: saidaTotal - retornoTotal - quebra.comcliente,
      perdidas: quebra.semcliente + quebra.comcliente + entrada.broken,
    };
  },

  async list(tenantId: string, take = 100) {
    const db = getTenantPrisma(tenantId);
    return db.plasticCrateMovement.findMany({
      orderBy: { movementDate: "desc" },
      take,
    });
  },

  async registrar(input: CaixaMovimentoInput, ctx: TenantCtx) {
    const saldo = await this.getSaldo(ctx.tenantId);

    // Consistência: não deixa o saldo ficar negativo.
    if (input.type === "SAIDA" && input.quantity > saldo.vazias) {
      throw new BusinessRuleError(
        `Você tem ${saldo.vazias} caixa(s) vazia(s) em estoque. Registre uma ENTRADA antes.`,
      );
    }
    if (input.type === "RETORNO" && input.quantity > saldo.comClientes) {
      throw new BusinessRuleError(
        `Há ${saldo.comClientes} caixa(s) com clientes. Confira as saídas registradas.`,
      );
    }
    if (input.type === "QUEBRA") {
      const isComCliente = Boolean(input.customerName);
      const limite = isComCliente ? saldo.comClientes : saldo.vazias;
      if (input.quantity > limite) {
        throw new BusinessRuleError(
          isComCliente
            ? `Há apenas ${saldo.comClientes} caixa(s) com clientes.`
            : `Há apenas ${saldo.vazias} caixa(s) vazia(s) em estoque.`,
        );
      }
    }

    const db = getTenantPrisma(ctx.tenantId);
    return db.$transaction(async (tx) => {
      const movement = await tx.plasticCrateMovement.create({
        data: {
          tenantId: ctx.tenantId,
          type: input.type,
          quantity: input.quantity,
          brokenQty: input.type === "ENTRADA" ? (input.brokenQty ?? 0) : 0,
          customerName: input.customerName || null,
          supplierName: input.type === "ENTRADA" ? input.supplierName || null : null,
          movementDate: new Date(input.movementDate),
          notes: input.notes ?? null,
        },
      });
      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "CREATE",
          entity: "PlasticCrateMovement",
          entityId: movement.id,
          newData: {
            type: input.type,
            quantity: input.quantity,
            customerName: input.customerName,
          },
          ip: ctx.ip,
        },
        tx,
      );
      return movement;
    });
  },
};
