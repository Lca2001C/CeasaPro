import { cache } from "react";
import type { Prisma, PlasticCrateMovement, PlasticCrateMovementType } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { audit } from "@/lib/audit";
import { BusinessRuleError, ForbiddenError, NotFoundError } from "@/lib/http/app-error";
import type { CaixaMovimentoInput } from "@/lib/validations/caixa";
import type { TenantCtx } from "@/lib/http/with-action";
import { comIdempotencia } from "@/lib/http/idempotencia";
import {
  dentroDoPrazoDeDesfazer,
  foraDoPrazoDeDesfazer,
  podeDesfazer,
} from "@/lib/desfazer/prazo";
import { parseFormDateTz } from "@/lib/tz";
import { ORIGEM_TRANSFERIDO_PARA_CAIXAS } from "@/lib/estoque/origens";
import { FinancialCalc } from "./financial-calc.service";

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
export type MovimentoCaixaInterno = Omit<CaixaMovimentoInput, "type" | "unitCost"> & {
  type: PlasticCrateMovementType;
  /** Custo de cada caixa: digitado na ENTRADA, o custo médio na VENDA. */
  unitCost?: Prisma.Decimal | number | null;
};

/** Dados internos do movimento — nunca vêm do cliente, só de outros serviços. */
export interface CrateMovementLink {
  saleId?: string | null;
  crateCleaningId?: string | null;
  purchaseId?: string | null;
  /** Venda de embalagem do tipo vinculado às caixas (movimento VENDA). */
  packagingSaleId?: string | null;
}

/** A ENTRADA de caixas de uma compra, como o cancelamento dela a lê. */
export interface EntradaDeCaixasDaCompra {
  quantity: number;
  brokenQty: number;
  dirty: boolean;
  supplierName: string | null;
  movementDate: Date;
}

/** Cliente mínimo aceito por `registrarInTx` (prisma base ou `tx` de transação). */
type CrateTxClient = {
  /** Necessário para ler o saldo DENTRO da transação. */
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  /** Para o advisory lock, que devolve `void` e o `$queryRaw` não desserializa. */
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
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
  /** Todas as quebradas na chegada (limpas + sujas) — vão para `perdidas`. */
  entrada_quebrada: number;
  /** A parte de `entrada_quebrada` que chegou em ENTRADA suja. */
  entrada_quebrada_suja: number;
  saida: number;
  retorno: number;
  saida_hig: number;
  retorno_hig: number;
  quebra_cliente: number;
  quebra_higienizador: number;
  quebra_limpa: number;
  quebra_suja: number;
  estorno_saida: number;
  /** Envio para higienização desfeito: volta às sujas, sai do higienizador. */
  estorno_saida_hig: number;
  /** Vendidas como embalagem (líquido: a venda cancelada entra negativa). */
  venda: number;
}

const ZERO_ROW: SaldoRow = {
  entrada_limpa: 0,
  entrada_suja: 0,
  entrada_quebrada: 0,
  entrada_quebrada_suja: 0,
  saida: 0,
  retorno: 0,
  saida_hig: 0,
  retorno_hig: 0,
  quebra_cliente: 0,
  quebra_higienizador: 0,
  quebra_limpa: 0,
  quebra_suja: 0,
  estorno_saida: 0,
  estorno_saida_hig: 0,
  venda: 0,
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
    case "ESTORNO_SAIDA_HIGIENIZACAO": // envio desfeito — volta para as sujas
      return true;
    case "ESTORNO_SAIDA": // cancelamento de venda: a caixa nunca saiu, volta limpa
    case "SAIDA": // sai do pote das limpas
    case "VENDA": // vendida como embalagem: sai das limpas
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
    case "VENDA":
      // Mesmo pote da saída emprestada: a caixa vendida é uma das limpas.
      if (input.quantity > saldo.limpas) {
        throw new BusinessRuleError(
          `Você tem ${saldo.limpas} caixa(s) plástica(s) limpa(s) e está vendendo ` +
            `${input.quantity}.` +
            (saldo.sujas > 0
              ? ` As ${saldo.sujas} suja(s) precisam passar pela higienização antes.`
              : " Registre a entrada antes ou ajuste a quantidade."),
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
    case "ESTORNO_SAIDA_HIGIENIZACAO":
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
 *   limpas         = ENTRADA(limpa) − quebradas na chegada(limpa) + RETORNO_HIGIENIZACAO − SAIDA − QUEBRA(limpa, no estoque) − VENDA
 *   sujas          = ENTRADA(suja)  − quebradas na chegada(suja)  + RETORNO − SAIDA_HIGIENIZACAO − QUEBRA(suja, no estoque)
 *   emHigienizacao = SAIDA_HIGIENIZACAO − RETORNO_HIGIENIZACAO − QUEBRA(no higienizador)
 *   comClientes    = SAIDA − RETORNO − QUEBRA(com cliente)
 *   perdidas       = QUEBRA(todas) + ENTRADA.brokenQty
 *   vazias         = limpas + sujas
 * Para dados anteriores à higienização integrada (dirty=false, cleanerName=null),
 * `limpas + sujas` reproduz a fórmula de `vazias` de docs/03-funcionalidades.md.
 *
 * `ENTRADA.quantity` é o TOTAL que chegou, quebradas incluídas — é o que a
 * compra e o formulário manual dizem ("Quantas caixas" + "Quebradas na
 * chegada", com quebradas ≤ total). As quebradas saem do pote em que entraram.
 */
/**
 * Serializa as escritas de caixa desta empresa, pela duração da transação.
 *
 * `limpas / sujas / emHigienizacao / comClientes` são um POOL ÚNICO por
 * empresa, derivado do livro-razão inteiro — não existe linha de saldo para
 * travar com `FOR UPDATE`, e travar a linha de `tenants` serializaria escritas
 * que nada têm a ver com caixa. A granularidade da invariante É a empresa,
 * então o lock tem de ser exatamente essa.
 *
 * Advisory lock de TRANSAÇÃO (e não de sessão): é liberado no commit, dentro da
 * mesma conexão, e por isso sobrevive ao pgbouncer em modo transaction do Neon
 * — `pg_advisory_lock`, de sessão, não sobreviveria. É reentrante, então
 * chamá-lo várias vezes na mesma transação (o cancelamento estorna item a item)
 * é inofensivo.
 *
 * O `1` é o domínio "caixas plásticas" dentro do namespace da empresa.
 */
async function travarCaixasDaEmpresa(
  tx: Pick<CrateTxClient, "$executeRaw">,
  tenantId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), 1)`;
}

/** O SQL do saldo, executável tanto no cliente base quanto num `tx`. */
async function lerSaldoCom(tx: CrateTxClient, tenantId: string): Promise<CrateSaldo> {
  // `::bigint`, não `::int`: cada movimento cabe no Int da coluna, mas a SOMA
  // não — dois lançamentos gigantes digitados por engano estouravam a soma e
  // travavam o módulo inteiro (inclusive o cancelamento que os corrigiria). É
  // o mesmo cuidado de `EmbalagensService.saldos`.
  const rows = await tx.$queryRaw<Record<keyof SaldoRow, bigint>[]>`
    SELECT
      COALESCE(SUM(CASE WHEN type::text = 'ENTRADA' AND NOT dirty THEN quantity ELSE 0 END), 0)::bigint AS entrada_limpa,
      COALESCE(SUM(CASE WHEN type::text = 'ENTRADA' AND dirty THEN quantity ELSE 0 END), 0)::bigint AS entrada_suja,
      COALESCE(SUM(CASE WHEN type::text = 'ENTRADA' THEN "brokenQty" ELSE 0 END), 0)::bigint AS entrada_quebrada,
      COALESCE(SUM(CASE WHEN type::text = 'ENTRADA' AND dirty THEN "brokenQty" ELSE 0 END), 0)::bigint AS entrada_quebrada_suja,
      COALESCE(SUM(CASE WHEN type::text = 'SAIDA' THEN quantity ELSE 0 END), 0)::bigint AS saida,
      COALESCE(SUM(CASE WHEN type::text = 'RETORNO' THEN quantity ELSE 0 END), 0)::bigint AS retorno,
      COALESCE(SUM(CASE WHEN type::text = 'SAIDA_HIGIENIZACAO' THEN quantity ELSE 0 END), 0)::bigint AS saida_hig,
      COALESCE(SUM(CASE WHEN type::text = 'RETORNO_HIGIENIZACAO' THEN quantity ELSE 0 END), 0)::bigint AS retorno_hig,
      COALESCE(SUM(CASE WHEN type::text = 'QUEBRA' AND "customerName" IS NOT NULL THEN quantity ELSE 0 END), 0)::bigint AS quebra_cliente,
      COALESCE(SUM(CASE WHEN type::text = 'QUEBRA' AND "customerName" IS NULL AND "cleanerName" IS NOT NULL THEN quantity ELSE 0 END), 0)::bigint AS quebra_higienizador,
      COALESCE(SUM(CASE WHEN type::text = 'QUEBRA' AND "customerName" IS NULL AND "cleanerName" IS NULL AND NOT dirty THEN quantity ELSE 0 END), 0)::bigint AS quebra_limpa,
      COALESCE(SUM(CASE WHEN type::text = 'QUEBRA' AND "customerName" IS NULL AND "cleanerName" IS NULL AND dirty THEN quantity ELSE 0 END), 0)::bigint AS quebra_suja,
      COALESCE(SUM(CASE WHEN type::text = 'ESTORNO_SAIDA' THEN quantity ELSE 0 END), 0)::bigint AS estorno_saida,
      COALESCE(SUM(CASE WHEN type::text = 'ESTORNO_SAIDA_HIGIENIZACAO' THEN quantity ELSE 0 END), 0)::bigint AS estorno_saida_hig,
      COALESCE(SUM(CASE WHEN type::text = 'VENDA' THEN quantity ELSE 0 END), 0)::bigint AS venda
    FROM plastic_crate_movements
    WHERE "tenantId" = ${tenantId}
  `;
  const linha = rows[0];
  if (!linha) return computeCrateSaldo(ZERO_ROW);
  const r = Object.fromEntries(
    Object.entries(linha).map(([k, v]) => [k, Number(v)]),
  ) as unknown as SaldoRow;
  return computeCrateSaldo(r);
}

/** Movimento do livro-razão como o custo médio das caixas o lê. */
export interface MovimentoDeCustoDeCaixa {
  id: string;
  type: string;
  quantity: number;
  brokenQty: number;
  unitCost: Prisma.Decimal | null;
  purchaseId: string | null;
  packagingSaleId: string | null;
  estornaId: string | null;
}

/**
 * Custo médio das caixas que a empresa POSSUI, na ordem de gravação.
 *
 * Muda a posse: ENTRADA (as boas, pelo custo digitado), VENDA e QUEBRA (saem
 * pelo custo médio). Emprestar ao cliente (SAIDA/RETORNO) e mandar higienizar
 * não mudam de quem é a caixa, então ficam fora — a caixa na rua continua
 * valendo o mesmo.
 *
 * Os estornos saem em PAR com o original, como em `custoMedioDoTipo` das
 * embalagens: a entrada desfeita (`estornaId`), a compra cancelada (ENTRADA
 * negativa com o mesmo `purchaseId`) e a venda cancelada (VENDA negativa com o
 * mesmo `packagingSaleId`). Assim o custo digitado errado não fica na média.
 *
 * Caixa antiga, que entrou antes de a entrada pedir custo, entra sem custo:
 * `custoMedioMovel` soma a quantidade e deixa a média para a primeira entrada
 * que informou o preço.
 */
export function custoMedioDasCaixas(movimentos: MovimentoDeCustoDeCaixa[]): Prisma.Decimal | null {
  const estornadas = new Set(movimentos.map((m) => m.estornaId).filter((id) => id !== null));
  const comprasCanceladas = new Set(
    movimentos
      .filter((m) => m.type === "ENTRADA" && m.quantity < 0 && m.purchaseId)
      .map((m) => m.purchaseId),
  );
  const vendasCanceladas = new Set(
    movimentos
      .filter((m) => m.type === "VENDA" && m.quantity < 0 && m.packagingSaleId)
      .map((m) => m.packagingSaleId),
  );
  const saiEmPar = (m: MovimentoDeCustoDeCaixa) =>
    m.estornaId !== null ||
    estornadas.has(m.id) ||
    (m.type === "ENTRADA" && m.purchaseId !== null && comprasCanceladas.has(m.purchaseId)) ||
    (m.type === "VENDA" && m.packagingSaleId !== null && vendasCanceladas.has(m.packagingSaleId));

  return FinancialCalc.custoMedioMovel(
    movimentos
      .filter((m) => !saiEmPar(m))
      .flatMap((m) => {
        if (m.type === "ENTRADA") {
          const boas = m.quantity - m.brokenQty;
          if (boas === 0) return [];
          return [{ entrada: boas > 0, quantidade: boas, custoUnitario: m.unitCost }];
        }
        if ((m.type === "VENDA" || m.type === "QUEBRA") && m.quantity > 0) {
          return [{ entrada: false, quantidade: m.quantity, custoUnitario: null }];
        }
        return [];
      }),
  );
}

/** Lê o livro-razão que muda a posse e devolve o custo médio de agora. */
async function lerCustoMedioCom(
  tx: Pick<CrateTxClient, "$queryRaw">,
  tenantId: string,
): Promise<Prisma.Decimal | null> {
  const movimentos = await tx.$queryRaw<MovimentoDeCustoDeCaixa[]>`
    SELECT id, type::text AS type, quantity, "brokenQty", "unitCost",
           "purchaseId", "packagingSaleId", "estornaId"
    FROM plastic_crate_movements
    WHERE "tenantId" = ${tenantId}
      AND type::text IN ('ENTRADA', 'VENDA', 'QUEBRA')
    ORDER BY "createdAt", id
  `;
  return custoMedioDasCaixas(movimentos);
}

/**
 * Movimento que mexe no pote "com o higienizador".
 *
 * Só nasce pelo lote de higienização (`HigienizacaoService`), sempre ligado a
 * ele por `crateCleaningId`. Solto, o pote global andava sem o lote saber: uma
 * perda de 3 lançada em "Registrar perda" com o nome do higienizador tirava 3
 * de `emHigienizacao`, o lote continuava cobrando essas 3 e a perda pelo
 * próprio lote passava a ser recusada ("Há apenas 0 caixa(s) no
 * higienizador") — o lote ficava ENVIADO para sempre.
 */
function mexeNoHigienizador(input: MovimentoCaixaInterno): boolean {
  if (
    input.type === "SAIDA_HIGIENIZACAO" ||
    input.type === "RETORNO_HIGIENIZACAO" ||
    input.type === "ESTORNO_SAIDA_HIGIENIZACAO"
  ) {
    return true;
  }
  return input.type === "QUEBRA" && !input.customerName && Boolean(input.cleanerName);
}

const saldoDaRequisicao = cache((tenantId: string) => lerSaldoCom(prisma, tenantId));

export const CaixasService = {
  /**
   * Toma o lock de caixas da empresa numa transação já aberta, sem ler saldo.
   *
   * Para quem precisa serializar uma decisão ANTES de ler os próprios dados: o
   * lote de higienização trava aqui e só então lê devolvidas/perdidas. Sem
   * isso, duas operações do mesmo lote liam o mesmo "pendentes", as duas
   * passavam e o lote resolvia mais caixas do que saíram.
   */
  async travarInTx(tx: Pick<CrateTxClient, "$executeRaw">, tenantId: string): Promise<void> {
    await travarCaixasDaEmpresa(tx, tenantId);
  },

  /**
   * Saldo para MOSTRAR. Memorizado por requisição (`cache()`): a tela de caixas
   * e embalagens lia o livro-razão inteiro duas vezes (aba Caixas e o saldo do
   * tipo "Caixa plástica" em Embalagens). Quem decide em cima do saldo usa
   * `getSaldoInTx`, lido dentro da transação e depois do lock.
   */
  async getSaldo(tenantId: string): Promise<CrateSaldo> {
    return saldoDaRequisicao(tenantId);
  },

  /**
   * Saldo lido DENTRO de uma transação já aberta, depois de travar a empresa.
   *
   * Para quem precisa DECIDIR com base no saldo, e não só gravar — o
   * cancelamento de venda usa `comClientes` para saber quantas caixas ainda
   * estão na rua e só estornar essas. Lida fora da transação, a decisão saía de
   * um retrato que outra operação já podia ter invalidado.
   */
  async getSaldoInTx(tx: CrateTxClient, tenantId: string): Promise<CrateSaldo> {
    await travarCaixasDaEmpresa(tx, tenantId);
    return lerSaldoCom(tx, tenantId);
  },

  /**
   * Caixas com UM cliente, lidas dentro da transação e depois do lock.
   *
   * É a mesma conta que `registrarInTx` usa para recusar um RETORNO/ESTORNO
   * acima do que o cliente tem — exportada para quem precisa DECIDIR a
   * quantidade antes de gravar. O cancelamento de venda decidia pelo saldo
   * global (`comClientes`): João levou 8, devolveu 5, outros 30 estavam na rua;
   * o estorno tentava 8, `registrarInTx` recusava ("João está com 3") e a venda
   * não podia mais ser cancelada.
   */
  async saldoDoClienteInTx(
    tx: CrateTxClient,
    tenantId: string,
    customerName: string,
  ): Promise<number> {
    await travarCaixasDaEmpresa(tx, tenantId);
    return saldoDoClienteInTx(tx, tenantId, customerName);
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
  async saldoPorCliente(tenantId: string): Promise<SaldoDeCaixasPorCliente> {
    // Agrupado pela IDENTIDADE do cliente (`lower(btrim())`, a mesma da aba
    // Clientes): "Zé Silva" e "zé silva" eram dois saldos — a ficha juntava as
    // vendas, mas o fiado do segundo nome mostrava 0 caixas e recusava a
    // devolução.
    const rows = await prisma.$queryRaw<{ customer: string; saldo: bigint }[]>`
      SELECT MIN("customerName") AS customer,
             COALESCE(SUM(
               CASE WHEN type::text = 'SAIDA' THEN quantity
                    WHEN type::text IN ('RETORNO', 'QUEBRA', 'ESTORNO_SAIDA') THEN -quantity
                    ELSE 0 END
             ), 0)::bigint AS saldo
      FROM plastic_crate_movements
      WHERE "tenantId" = ${tenantId} AND "customerName" IS NOT NULL
      GROUP BY lower(btrim("customerName"))
    `;
    // Soma por identidade ANTES de filtrar o positivo: se o `lower()` do banco
    // separar dois nomes que o JS junta (collation, espaço que não é ASCII),
    // o segundo grupo sobrescrevia o primeiro em vez de somar.
    const porChave = new Map<string, { nome: string; saldo: number }>();
    for (const r of rows) {
      const k = chaveDeCliente(r.customer);
      const atual = porChave.get(k);
      if (atual) atual.saldo += Number(r.saldo);
      else porChave.set(k, { nome: r.customer, saldo: Number(r.saldo) });
    }
    const map = new SaldoDeCaixasPorCliente();
    for (const { nome, saldo } of porChave.values()) {
      if (saldo > 0) map.definir(nome, saldo);
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
   *
   * O saldo é lido AQUI DENTRO, depois do lock — e não recebido pronto.
   *
   * Antes, cada chamador lia `getSaldo` antes de abrir a transação e passava o
   * retrato adiante; sete lugares faziam isso, e os comentários admitiam
   * ("Saldo lido FORA da transação"). Era um TOCTOU clássico: com 5 caixas
   * limpas, duas vendas simultâneas de 5 liam as duas o mesmo 5, as duas
   * passavam em `assertCrateMovement` e o pote terminava em −5. E
   * `computeCrateSaldo` não tem piso, então a tela passava a exibir estoque
   * negativo.
   *
   * Tirar o parâmetro (em vez de deixá-lo opcional) é deliberado: parâmetro
   * opcional convida o próximo a continuar passando um saldo velho.
   */
  async registrarInTx(
    tx: CrateTxClient,
    input: MovimentoCaixaInterno & CrateMovementLink,
    ctx: TenantCtx,
  ) {
    if (mexeNoHigienizador(input) && !input.crateCleaningId) {
      throw new BusinessRuleError(
        "Caixa enviada, devolvida ou perdida no higienizador se registra no próprio " +
          "envio, em Higienização.",
      );
    }
    if (input.type === "ENTRADA" && (input.brokenQty ?? 0) > input.quantity) {
      throw new BusinessRuleError(
        "As caixas quebradas não podem passar do total de caixas recebidas.",
      );
    }
    await travarCaixasDaEmpresa(tx, ctx.tenantId);
    const saldo = await lerSaldoCom(tx, ctx.tenantId);
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
        purchaseId: input.purchaseId ?? null,
        packagingSaleId: input.packagingSaleId ?? null,
        // Custo só onde ele forma ou leva a média: o que entrou e o que foi vendido.
        unitCost:
          input.type === "ENTRADA" || input.type === "VENDA" ? (input.unitCost ?? null) : null,
        idempotencyKey: input.idempotencyKey ?? null,
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

  /**
   * Desfaz as caixas que chegaram com uma compra cancelada.
   *
   * O estorno é a ENTRADA espelhada — mesmas quantidades com sinal trocado,
   * mesmo pote (limpa ou suja), ligada à compra. Assim toda fórmula de saldo
   * (`computeCrateSaldo`) fecha sem conhecer um tipo novo: entrada e estorno se
   * anulam em `limpas`/`sujas`, e as quebradas na chegada saem de `perdidas`.
   *
   * Recusa se o pote já não tem as caixas boas da compra: elas saíram com
   * cliente ou foram para a higienização, e tirá-las do estoque deixaria o pote
   * negativo. É a mesma regra da mercadoria — a compra só é desfeita enquanto o
   * que ela trouxe ainda está no box.
   *
   * @returns quantas caixas (o total recebido, quebradas incluídas) foram estornadas.
   */
  async estornarEntradasDaCompraInTx(
    tx: CrateTxClient,
    purchaseId: string,
    entradas: EntradaDeCaixasDaCompra[],
    ctx: TenantCtx,
  ): Promise<number> {
    if (entradas.length === 0) return 0;
    await travarCaixasDaEmpresa(tx, ctx.tenantId);
    const saldo = await lerSaldoCom(tx, ctx.tenantId);

    const boas = (sujas: boolean) =>
      entradas
        .filter((e) => e.dirty === sujas)
        .reduce((total, e) => total + e.quantity - e.brokenQty, 0);
    const [limpas, sujas] = [boas(false), boas(true)];
    if (limpas > saldo.limpas || sujas > saldo.sujas) {
      throw new BusinessRuleError(
        `As caixas desta compra já saíram do box (há ${saldo.limpas} limpa(s) e ` +
          `${saldo.sujas} suja(s) em estoque). A compra não pode mais ser cancelada.`,
      );
    }

    let estornadas = 0;
    for (const e of entradas) {
      const movement = await tx.plasticCrateMovement.create({
        data: {
          tenantId: ctx.tenantId,
          type: "ENTRADA",
          quantity: -e.quantity,
          brokenQty: -e.brokenQty,
          dirty: e.dirty,
          supplierName: e.supplierName,
          purchaseId,
          // A data da ENTRADA, não a de hoje: entrada e estorno se anulam no
          // mesmo dia do relatório, em vez de um mês mostrar caixas que nunca
          // chegaram e o seguinte, uma saída que nunca houve.
          movementDate: e.movementDate,
          notes: "Estorno pelo cancelamento da compra",
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
          newData: { type: "ENTRADA", quantity: -e.quantity, purchaseId },
          ip: ctx.ip,
        },
        tx,
      );
      estornadas += e.quantity;
    }
    return estornadas;
  },

  /**
   * Custo médio das caixas (`custoMedioDasCaixas`) lido dentro da transação,
   * depois do lock: a VENDA leva o custo do que estava no box naquela hora.
   */
  async custoMedioInTx(
    tx: Pick<CrateTxClient, "$queryRaw" | "$executeRaw">,
    tenantId: string,
  ): Promise<Prisma.Decimal | null> {
    await travarCaixasDaEmpresa(tx, tenantId);
    return lerCustoMedioCom(tx, tenantId);
  },

  /**
   * Devolve às limpas as caixas de uma venda de embalagem cancelada.
   *
   * O estorno é a VENDA espelhada — quantidade negativa, mesmo `packagingSaleId`,
   * mesma data, pelo custo com que saiu. `computeCrateSaldo` soma as duas e o
   * par sai junto do custo médio. Sem VENDA (venda de antes do vínculo) não há
   * o que devolver aqui.
   *
   * @returns quantas caixas voltaram.
   */
  async estornarVendaInTx(
    tx: CrateTxClient,
    packagingSaleId: string,
    ctx: TenantCtx,
  ): Promise<number> {
    await travarCaixasDaEmpresa(tx, ctx.tenantId);
    const movimentos = await tx.$queryRaw<
      { quantity: number; unitCost: Prisma.Decimal | null; movementDate: Date; customerName: string | null }[]
    >`
      SELECT quantity, "unitCost", "movementDate", "customerName"
      FROM plastic_crate_movements
      WHERE "tenantId" = ${ctx.tenantId} AND "packagingSaleId" = ${packagingSaleId}
        AND type::text = 'VENDA'
    `;
    const vendidas = movimentos.reduce((total, m) => total + m.quantity, 0);
    const original = movimentos.find((m) => m.quantity > 0);
    if (!original || vendidas <= 0) return 0;

    const movement = await tx.plasticCrateMovement.create({
      data: {
        tenantId: ctx.tenantId,
        type: "VENDA",
        quantity: -vendidas,
        dirty: false,
        customerName: original.customerName,
        packagingSaleId,
        unitCost: original.unitCost,
        // Na data da venda: o par se anula no mesmo dia do relatório.
        movementDate: original.movementDate,
        notes: "Venda de embalagem cancelada",
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
        newData: { type: "VENDA", quantity: -vendidas, packagingSaleId },
        ip: ctx.ip,
      },
      tx,
    );
    return vendidas;
  },

  /**
   * Lançamento manual (formulário de caixas, entrada do tipo vinculado em
   * Embalagens, devolução no fiado).
   *
   * A ENTRADA com custo é compra de caixa: gera a conta `COMPRA_EMBALAGEM`,
   * PAGA no dia, na mesma transação — como a entrada de embalagem
   * (`EmbalagensService.gravarEntrada`). A conta fica fora do lucro: o custo
   * entra pela venda da caixa (custo médio). A ENTRADA da compra de mercadoria
   * não passa por aqui (`registrarInTx`), porque o que se pagou ao fornecedor
   * já é a conta da compra.
   */
  async registrar(input: MovimentoCaixaInterno & CrateMovementLink, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    return comIdempotencia(
      input.idempotencyKey,
      (k) => db.plasticCrateMovement.findFirst({ where: { idempotencyKey: k } }),
      () =>
        db.$transaction(async (tx) => {
          const movement = await this.registrarInTx(tx, input, ctx);
          if (input.type === "ENTRADA" && input.unitCost !== undefined && input.unitCost !== null) {
            const hoje = new Date();
            await tx.expense.create({
              data: {
                tenantId: ctx.tenantId,
                origem: "COMPRA_EMBALAGEM",
                plasticCrateMovementId: movement.id,
                description: `Compra de caixas plásticas — ${input.quantity} caixa(s)`,
                amount: FinancialCalc.valorTotalCompra(input.quantity, input.unitCost),
                type: "VARIAVEL",
                recurring: false,
                status: "PAGO",
                dueDate: hoje,
                paidDate: hoje,
              },
            });
          }
          return movement;
        }),
    );
  },

  /**
   * Desfaz a ENTRADA manual lançada errada — até 24 h, só o dono (regra única,
   * `src/lib/desfazer/prazo.ts`). Entra a ENTRADA espelhada ligada por
   * `estornaId` (o par sai do custo médio) e a conta da compra é cancelada.
   *
   * Recusa se as caixas boas dessa entrada já não estão no pote em que
   * entraram, e se houve VENDA ou QUEBRA depois dela: essas já saíram pelo
   * custo médio que a entrada formou.
   */
  async desfazerEntrada(input: { id: string }, ctx: TenantCtx) {
    if (!podeDesfazer(ctx.session.role)) {
      throw new ForbiddenError("Só o responsável pela empresa pode desfazer uma entrada.");
    }
    const db = getTenantPrisma(ctx.tenantId);
    return db.$transaction(async (tx) => {
      await travarCaixasDaEmpresa(tx, ctx.tenantId);
      const entrada = await tx.plasticCrateMovement.findFirst({
        where: { id: input.id, type: "ENTRADA", purchaseId: null, estornaId: null },
      });
      if (!entrada || entrada.quantity <= 0) throw new NotFoundError("Entrada não encontrada");
      // A ENTRADA que trouxe o saldo antigo da aba Embalagens não é lançamento
      // de ninguém: desfazê-la sumiria com as caixas, e o tipo já foi zerado.
      const transferida = await tx.packagingMovement.findFirst({
        where: { sourceType: ORIGEM_TRANSFERIDO_PARA_CAIXAS, sourceId: entrada.id },
        select: { id: true },
      });
      if (transferida) throw new NotFoundError("Entrada não encontrada");
      if (!dentroDoPrazoDeDesfazer(entrada.createdAt)) {
        throw new BusinessRuleError(foraDoPrazoDeDesfazer("desfazer esta entrada"));
      }
      const jaDesfeita = await tx.plasticCrateMovement.findFirst({
        where: { estornaId: entrada.id },
        select: { id: true },
      });
      if (jaDesfeita) throw new BusinessRuleError("Esta entrada já foi desfeita.");
      const consumiuCusto = await tx.plasticCrateMovement.count({
        where: {
          type: { in: ["VENDA", "QUEBRA"] },
          OR: [
            { createdAt: { gt: entrada.createdAt } },
            { createdAt: entrada.createdAt, id: { gt: entrada.id } },
          ],
        },
      });
      if (consumiuCusto > 0) {
        throw new BusinessRuleError(
          "Já houve venda ou perda de caixas depois desta entrada. Não dá para desfazer.",
        );
      }
      const saldo = await lerSaldoCom(tx, ctx.tenantId);
      const boas = entrada.quantity - entrada.brokenQty;
      const pote = entrada.dirty ? saldo.sujas : saldo.limpas;
      if (boas > pote) {
        throw new BusinessRuleError(
          `As caixas desta entrada já saíram do box (há ${pote} ` +
            `${entrada.dirty ? "suja(s)" : "limpa(s)"} em estoque). Não dá para desfazer.`,
        );
      }
      await tx.plasticCrateMovement.create({
        data: {
          tenantId: ctx.tenantId,
          type: "ENTRADA",
          quantity: -entrada.quantity,
          brokenQty: -entrada.brokenQty,
          dirty: entrada.dirty,
          supplierName: entrada.supplierName,
          unitCost: entrada.unitCost,
          estornaId: entrada.id,
          movementDate: entrada.movementDate,
          notes: "Entrada desfeita",
        },
      });
      await tx.expense.updateMany({
        where: { plasticCrateMovementId: entrada.id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "UPDATE",
          entity: "PlasticCrateMovement",
          entityId: entrada.id,
          oldData: { quantity: entrada.quantity },
          newData: { desfeita: true },
          ip: ctx.ip,
        },
        tx,
      );
      return { id: entrada.id };
    });
  },
};

/** Exposta para teste unitário das fórmulas de saldo. */
/**
 * Quantas caixas estão com este cliente, contadas dentro da transação.
 *
 * Mesma fórmula de `comClientes`: SAIDA − RETORNO − QUEBRA − ESTORNO_SAIDA,
 * restrita ao nome.
 *
 * O `tenantId` vai explícito no `where` por DEFESA, não por necessidade: os
 * chamadores abrem a transação a partir do cliente estendido, e no Prisma 6 as
 * extensões de `query` continuam valendo dentro de transações interativas — ou
 * seja, o filtro seria injetado de qualquer forma. (O comentário anterior
 * afirmava o contrário: que o `tx` era o cliente cru, sem extensão. Estava
 * errado, e era sobre ele que a próxima pessoa decidiria se podia omitir o
 * filtro — `perdasPorLote`, em `higienizacao.service.ts`, já depende justamente
 * da extensão que ele dizia não existir.)
 */
async function saldoDoClienteInTx(
  tx: CrateTxClient,
  tenantId: string,
  customerName: string,
): Promise<number> {
  // A identidade do cliente é a MESMA de `saldoPorCliente`: `lower(btrim())`
  // no banco. O `equals` com `mode: "insensitive"` do Prisma era outra regra
  // (sem aparar as pontas, e por `ILIKE`, onde `%`/`_` no nome viram curinga):
  // o saldo conferido na devolução podia não ser o que a tela mostrava.
  const rows = await tx.$queryRaw<{ saldo: bigint }[]>`
    SELECT COALESCE(SUM(
             CASE WHEN type::text = 'SAIDA' THEN quantity
                  WHEN type::text IN ('RETORNO', 'QUEBRA', 'ESTORNO_SAIDA') THEN -quantity
                  ELSE 0 END
           ), 0)::bigint AS saldo
    FROM plastic_crate_movements
    WHERE "tenantId" = ${tenantId} AND "customerName" IS NOT NULL
      AND lower(btrim("customerName")) = lower(btrim(${customerName}))
  `;
  return Number(rows[0]?.saldo ?? 0);
}

/**
 * Saldo de caixas por cliente. Itera pelo nome de exibição, mas o `get` busca
 * pela identidade do cliente (sem caixa nem espaços nas pontas) — quem chama
 * passa o nome como está na conta ou na venda.
 */
export class SaldoDeCaixasPorCliente extends Map<string, number> {
  private readonly porChave = new Map<string, number>();

  definir(nome: string, saldo: number): void {
    super.set(nome, saldo);
    this.porChave.set(chaveDeCliente(nome), saldo);
  }

  override get(nome: string): number | undefined {
    return this.porChave.get(chaveDeCliente(nome));
  }
}

function chaveDeCliente(nome: string): string {
  return nome.trim().toLocaleLowerCase("pt-BR");
}

export function computeCrateSaldo(r: SaldoRow): CrateSaldo {
  // O estorno de venda desfaz uma SAIDA: a caixa volta para as limpas (nunca
  // chegou a sair do box) e deixa de estar com o cliente.
  //
  // As quebradas na chegada saem do pote em que entraram: `ENTRADA.quantity` é
  // o total recebido. Sem descontá-las, uma compra de 30 com 4 quebradas dava
  // 30 limpas E 4 perdidas — 34 caixas de 30 — e a SAIDA de 30 passava com só
  // 26 boas no box.
  const quebradaNaChegadaLimpa = r.entrada_quebrada - r.entrada_quebrada_suja;
  // A VENDA (caixa vendida como embalagem) sai das limpas e não fica com
  // ninguém: não entra em `comClientes` nem em `perdidas`. A cancelada é uma
  // VENDA negativa, então `venda` já vem líquido.
  const limpas =
    r.entrada_limpa -
    quebradaNaChegadaLimpa +
    r.retorno_hig +
    r.estorno_saida -
    r.saida -
    r.quebra_limpa -
    r.venda;
  // O estorno do envio para higienização desfaz uma SAIDA_HIGIENIZACAO: as
  // caixas voltam às SUJAS (nunca foram lavadas) e saem do higienizador.
  const sujas =
    r.entrada_suja -
    r.entrada_quebrada_suja +
    r.retorno -
    r.saida_hig +
    r.estorno_saida_hig -
    r.quebra_suja;
  const quebraTotal =
    r.quebra_cliente + r.quebra_higienizador + r.quebra_limpa + r.quebra_suja;
  return {
    limpas,
    sujas,
    emHigienizacao: r.saida_hig - r.estorno_saida_hig - r.retorno_hig - r.quebra_higienizador,
    comClientes: r.saida - r.retorno - r.quebra_cliente - r.estorno_saida,
    perdidas: quebraTotal + r.entrada_quebrada,
    vazias: limpas + sujas,
  };
}

export type { SaldoRow };
