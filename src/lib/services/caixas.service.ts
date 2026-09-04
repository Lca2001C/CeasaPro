import type { Prisma, PlasticCrateMovement, PlasticCrateMovementType } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { audit } from "@/lib/audit";
import { BusinessRuleError } from "@/lib/http/app-error";
import type { CaixaMovimentoInput } from "@/lib/validations/caixa";
import type { TenantCtx } from "@/lib/http/with-action";
import { parseFormDateTz } from "@/lib/tz";

export interface CrateSaldo {
  limpas: number; // no estoque, prontas para vender
  sujas: number; // no estoque, aguardando higienização
  emHigienizacao: number; // com o higienizador
  comClientes: number;
  perdidas: number; // quebradas/sumidas (inclui as que chegaram quebradas)
  vazias: number; // limpas + sujas — total no estoque (mantido por compatibilidade)
}

/**
 * Movimento como os SERVIÇOS o enxergam.
 *
 * O `type` aqui é o enum do banco, não o do formulário: `ESTORNO_SAIDA` só é
 * criado pelo cancelamento de venda e de propósito não aparece no dropdown de
 * "Movimentar caixas" — ninguém lança estorno à mão.
 */
export type MovimentoCaixaInterno = Omit<CaixaMovimentoInput, "type"> & {
  type: PlasticCrateMovementType;
};

/** Dados internos do movimento — nunca vêm do cliente, só de outros serviços. */
export interface CrateMovementLink {
  saleId?: string | null;
  crateCleaningId?: string | null;
}

/** Cliente mínimo aceito por `registrarInTx` (prisma base ou `tx` de transação). */
type CrateTxClient = {
  plasticCrateMovement: {
    create(args: {
      data: Prisma.PlasticCrateMovementUncheckedCreateInput;
    }): Promise<PlasticCrateMovement>;
    findMany(args: {
      where: Prisma.PlasticCrateMovementWhereInput;
      select: { type: true; quantity: true };
    }): Promise<{ type: PlasticCrateMovementType; quantity: number }[]>;
  };
  auditLog: {
    create(args: { data: Prisma.AuditLogUncheckedCreateInput }): Promise<unknown>;
  };
};

interface SaldoRow {
  entrada_limpa: number;
  entrada_suja: number;
  entrada_quebrada: number;
  saida: number;
  retorno: number;
  saida_hig: number;
  retorno_hig: number;
  quebra_cliente: number;
  quebra_higienizador: number;
  quebra_limpa: number;
  quebra_suja: number;
  estorno_saida: number;
}

const ZERO_ROW: SaldoRow = {
  entrada_limpa: 0,
  entrada_suja: 0,
  entrada_quebrada: 0,
  saida: 0,
  retorno: 0,
  saida_hig: 0,
  retorno_hig: 0,
  quebra_cliente: 0,
  quebra_higienizador: 0,
  quebra_limpa: 0,
  quebra_suja: 0,
  estorno_saida: 0,
};

/**
 * Em qual "pote" do estoque o movimento mexe:
 *  - false → caixas limpas (prontas para vender)
 *  - true  → caixas sujas (aguardando higienização)
 * Na ENTRADA e na QUEBRA quem decide é o usuário; nos outros tipos é o próprio tipo.
 */
function resolveDirty(input: MovimentoCaixaInterno): boolean {
  switch (input.type) {
    case "RETORNO": // cliente devolve — volta suja
    case "SAIDA_HIGIENIZACAO": // sai do pote das sujas
      return true;
    case "ESTORNO_SAIDA": // cancelamento de venda: a caixa nunca saiu, volta limpa
    case "SAIDA": // sai do pote das limpas
    case "RETORNO_HIGIENIZACAO": // volta limpa do higienizador
      return false;
    default: // ENTRADA | QUEBRA
      return input.dirty ?? false;
  }
}

/**
 * Consistência do livro-razão: nenhum pote pode ficar negativo.
 * Função pura — o saldo é lido antes e passado aqui, para poder rodar dentro de transações.
 */
/**
 * @param saldoDoCliente saldo de caixas do cliente do movimento, quando há um.
 *   O saldo global não basta: uma devolução de 40 caixas em nome de quem levou
 *   20 passava, porque a empresa tinha 100 na rua com outros fregueses. O
 *   ledger daquele cliente ia a negativo e o estoque de sujas ganhava caixas
 *   que não existem. Quem chama por `registrarInTx` nunca precisa lembrar:
 *   o saldo é lido lá dentro.
 */
export function assertCrateMovement(
  saldo: CrateSaldo,
  input: MovimentoCaixaInterno,
  saldoDoCliente?: number,
): void {
  if (input.customerName && saldoDoCliente !== undefined) {
    const tiraDoCliente =
      input.type === "RETORNO" ||
      input.type === "ESTORNO_SAIDA" ||
      input.type === "QUEBRA";
    if (tiraDoCliente && input.quantity > saldoDoCliente) {
      throw new BusinessRuleError(
        `${input.customerName} está com ${saldoDoCliente} caixa(s). ` +
          "Confira o nome e a quantidade.",
      );
    }
  }
  switch (input.type) {
    case "SAIDA":
      if (input.quantity > saldo.limpas) {
        throw new BusinessRuleError(
          saldo.sujas > 0
            ? `Você tem ${saldo.limpas} caixa(s) limpa(s) e ${saldo.sujas} suja(s). Envie as sujas para higienização ou registre uma ENTRADA.`
            : `Você tem ${saldo.limpas} caixa(s) limpa(s) em estoque. Registre uma ENTRADA antes.`,
        );
      }
      return;
    case "ESTORNO_SAIDA":
    case "RETORNO":
      if (input.quantity > saldo.comClientes) {
        throw new BusinessRuleError(
          `Há ${saldo.comClientes} caixa(s) com clientes. Confira as saídas registradas.`,
        );
      }
      return;
    case "SAIDA_HIGIENIZACAO":
      if (input.quantity > saldo.sujas) {
        throw new BusinessRuleError(
          `Há ${saldo.sujas} caixa(s) suja(s) em estoque para higienizar.`,
        );
      }
      return;
    case "RETORNO_HIGIENIZACAO":
      if (input.quantity > saldo.emHigienizacao) {
        throw new BusinessRuleError(
          `Há ${saldo.emHigienizacao} caixa(s) no higienizador.`,
        );
      }
      return;
    case "QUEBRA": {
      if (input.customerName) {
        if (input.quantity > saldo.comClientes) {
          throw new BusinessRuleError(`Há apenas ${saldo.comClientes} caixa(s) com clientes.`);
        }
        return;
      }
      if (input.cleanerName) {
        if (input.quantity > saldo.emHigienizacao) {
          throw new BusinessRuleError(
            `Há apenas ${saldo.emHigienizacao} caixa(s) no higienizador.`,
          );
        }
        return;
      }
      const limite = input.dirty ? saldo.sujas : saldo.limpas;
      if (input.quantity > limite) {
        throw new BusinessRuleError(
          input.dirty
            ? `Há apenas ${saldo.sujas} caixa(s) suja(s) em estoque.`
            : `Há apenas ${saldo.limpas} caixa(s) limpa(s) em estoque.`,
        );
      }
      return;
    }
    default:
      return; // ENTRADA sempre pode
  }
}

/**
 * Caixas plásticas — livro-razão (append-only). Saldos são DERIVADOS:
 *   limpas         = ENTRADA(limpa) + RETORNO_HIGIENIZACAO − SAIDA − QUEBRA(limpa, no estoque)
 *   sujas          = ENTRADA(suja)  + RETORNO             − SAIDA_HIGIENIZACAO − QUEBRA(suja, no estoque)
 *   emHigienizacao = SAIDA_HIGIENIZACAO − RETORNO_HIGIENIZACAO − QUEBRA(no higienizador)
 *   comClientes    = SAIDA − RETORNO − QUEBRA(com cliente)
 *   perdidas       = QUEBRA(todas) + ENTRADA.brokenQty
 *   vazias         = limpas + sujas
 * Para dados anteriores à higienização integrada (dirty=false, cleanerName=null),
 * `limpas + sujas` reproduz exatamente a fórmula antiga de `vazias`.
 */
export const CaixasService = {
  async getSaldo(tenantId: string): Promise<CrateSaldo> {
    const rows = await prisma.$queryRaw<SaldoRow[]>`
      SELECT
        COALESCE(SUM(CASE WHEN type::text = 'ENTRADA' AND NOT dirty THEN quantity ELSE 0 END), 0)::int AS entrada_limpa,
        COALESCE(SUM(CASE WHEN type::text = 'ENTRADA' AND dirty THEN quantity ELSE 0 END), 0)::int AS entrada_suja,
        COALESCE(SUM(CASE WHEN type::text = 'ENTRADA' THEN "brokenQty" ELSE 0 END), 0)::int AS entrada_quebrada,
        COALESCE(SUM(CASE WHEN type::text = 'SAIDA' THEN quantity ELSE 0 END), 0)::int AS saida,
        COALESCE(SUM(CASE WHEN type::text = 'RETORNO' THEN quantity ELSE 0 END), 0)::int AS retorno,
        COALESCE(SUM(CASE WHEN type::text = 'SAIDA_HIGIENIZACAO' THEN quantity ELSE 0 END), 0)::int AS saida_hig,
        COALESCE(SUM(CASE WHEN type::text = 'RETORNO_HIGIENIZACAO' THEN quantity ELSE 0 END), 0)::int AS retorno_hig,
        COALESCE(SUM(CASE WHEN type::text = 'QUEBRA' AND "customerName" IS NOT NULL THEN quantity ELSE 0 END), 0)::int AS quebra_cliente,
        COALESCE(SUM(CASE WHEN type::text = 'QUEBRA' AND "customerName" IS NULL AND "cleanerName" IS NOT NULL THEN quantity ELSE 0 END), 0)::int AS quebra_higienizador,
        COALESCE(SUM(CASE WHEN type::text = 'QUEBRA' AND "customerName" IS NULL AND "cleanerName" IS NULL AND NOT dirty THEN quantity ELSE 0 END), 0)::int AS quebra_limpa,
        COALESCE(SUM(CASE WHEN type::text = 'QUEBRA' AND "customerName" IS NULL AND "cleanerName" IS NULL AND dirty THEN quantity ELSE 0 END), 0)::int AS quebra_suja,
        COALESCE(SUM(CASE WHEN type::text = 'ESTORNO_SAIDA' THEN quantity ELSE 0 END), 0)::int AS estorno_saida
      FROM plastic_crate_movements
      WHERE "tenantId" = ${tenantId}
    `;
    return computeCrateSaldo(rows[0] ?? ZERO_ROW);
  },

  /**
   * Saldo de caixas em poder de cada cliente.
   *
   * A conta é a mesma de `comClientes` em `computeCrateSaldo` — inclusive o
   * `ESTORNO_SAIDA`. Sem descontá-lo, a venda cancelada deixava caixas
   * fantasma no nome do cliente: a tela do fiado pedia devolução de caixas que
   * o estorno já havia trazido de volta, e o formulário aceitava a devolução —
   * que então tirava do saldo global caixas que ninguém devia.
   */
  async saldoPorCliente(tenantId: string): Promise<Map<string, number>> {
    const rows = await prisma.$queryRaw<{ customer: string; saldo: number }[]>`
      SELECT "customerName" AS customer,
             COALESCE(SUM(
               CASE WHEN type::text = 'SAIDA' THEN quantity
                    WHEN type::text IN ('RETORNO', 'QUEBRA', 'ESTORNO_SAIDA') THEN -quantity
                    ELSE 0 END
             ), 0)::int AS saldo
      FROM plastic_crate_movements
      WHERE "tenantId" = ${tenantId} AND "customerName" IS NOT NULL
      GROUP BY "customerName"
    `;
    const map = new Map<string, number>();
    for (const r of rows) {
      if (r.saldo > 0) map.set(r.customer, r.saldo);
    }
    return map;
  },

  async list(tenantId: string, take = 100) {
    const db = getTenantPrisma(tenantId);
    return db.plasticCrateMovement.findMany({
      orderBy: { movementDate: "desc" },
      take,
    });
  },

  /** Movimentos ligados a uma venda ou a um lote de higienização. */
  async listByLink(tenantId: string, link: CrateMovementLink) {
    const db = getTenantPrisma(tenantId);
    return db.plasticCrateMovement.findMany({
      where: {
        ...(link.saleId ? { saleId: link.saleId } : {}),
        ...(link.crateCleaningId ? { crateCleaningId: link.crateCleaningId } : {}),
      },
      orderBy: { movementDate: "asc" },
    });
  },

  /**
   * Grava o movimento dentro de uma transação já aberta (venda, higienização).
   * O `saldo` deve ser lido antes de abrir a transação e repassado aqui.
   */
  async registrarInTx(
    tx: CrateTxClient,
    input: MovimentoCaixaInterno & CrateMovementLink,
    ctx: TenantCtx,
    saldo: CrateSaldo,
  ) {
    // Lido dentro da transação: vê os movimentos que ela mesma acabou de
    // gravar (uma venda cancelada estorna item por item).
    const saldoDoCliente = input.customerName
      ? await saldoDoClienteInTx(tx, ctx.tenantId, input.customerName)
      : undefined;
    assertCrateMovement(saldo, input, saldoDoCliente);

    const movement = await tx.plasticCrateMovement.create({
      data: {
        tenantId: ctx.tenantId,
        type: input.type,
        quantity: input.quantity,
        brokenQty: input.type === "ENTRADA" ? (input.brokenQty ?? 0) : 0,
        dirty: resolveDirty(input),
        customerName: input.customerName || null,
        supplierName: input.type === "ENTRADA" ? input.supplierName || null : null,
        cleanerName: input.cleanerName || null,
        saleId: input.saleId ?? null,
        crateCleaningId: input.crateCleaningId ?? null,
        movementDate: parseFormDateTz(input.movementDate),
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
          cleanerName: input.cleanerName,
        },
        ip: ctx.ip,
      },
      tx,
    );
    return movement;
  },

  async registrar(input: MovimentoCaixaInterno & CrateMovementLink, ctx: TenantCtx) {
    const saldo = await this.getSaldo(ctx.tenantId);
    const db = getTenantPrisma(ctx.tenantId);
    return db.$transaction((tx) => this.registrarInTx(tx, input, ctx, saldo));
  },
};

/** Exposta para teste unitário das fórmulas de saldo. */
/**
 * Quantas caixas estão com este cliente, contadas dentro da transação.
 *
 * Mesma fórmula de `comClientes`: SAIDA − RETORNO − QUEBRA − ESTORNO_SAIDA,
 * restrita ao nome. O `where` leva `tenantId` explícito porque o `tx` aqui é
 * o cliente cru da transação, sem a extensão que injeta o tenant.
 */
async function saldoDoClienteInTx(
  tx: CrateTxClient,
  tenantId: string,
  customerName: string,
): Promise<number> {
  const movs = await tx.plasticCrateMovement.findMany({
    where: { tenantId, customerName },
    select: { type: true, quantity: true },
  });
  let saldo = 0;
  for (const m of movs) {
    if (m.type === "SAIDA") saldo += m.quantity;
    else if (m.type === "RETORNO" || m.type === "QUEBRA" || m.type === "ESTORNO_SAIDA") {
      saldo -= m.quantity;
    }
  }
  return saldo;
}

export function computeCrateSaldo(r: SaldoRow): CrateSaldo {
  // O estorno de venda desfaz uma SAIDA: a caixa volta para as limpas (nunca
  // chegou a sair do box) e deixa de estar com o cliente.
  const limpas =
    r.entrada_limpa + r.retorno_hig + r.estorno_saida - r.saida - r.quebra_limpa;
  const sujas = r.entrada_suja + r.retorno - r.saida_hig - r.quebra_suja;
  const quebraTotal =
    r.quebra_cliente + r.quebra_higienizador + r.quebra_limpa + r.quebra_suja;
  return {
    limpas,
    sujas,
    emHigienizacao: r.saida_hig - r.retorno_hig - r.quebra_higienizador,
    comClientes: r.saida - r.retorno - r.quebra_cliente - r.estorno_saida,
    perdidas: quebraTotal + r.entrada_quebrada,
    vazias: limpas + sujas,
  };
}

export type { SaldoRow };
