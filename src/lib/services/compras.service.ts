import type { Prisma } from "@prisma/client";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit";
import { FinancialCalc } from "./financial-calc.service";
import { add, mul, money, toDecimal } from "@/lib/money";
import { BusinessRuleError, ForbiddenError, NotFoundError } from "@/lib/http/app-error";
import { CaixasService } from "./caixas.service";
import { saldoECustoMedio } from "./estoque.service";
import type { CancelarCompraInput, CompraInput } from "@/lib/validations/compra";
import type { TenantCtx } from "@/lib/http/with-action";
import { parseFormDateTz } from "@/lib/tz";
import { formatBRL, formatQty } from "@/lib/format";
import { COMPRA_EXPENSE_CATEGORY } from "@/lib/constants";
import { isModuleEnabled } from "@/lib/plan/modules";
import { passaDoEstoque } from "@/lib/estoque/nivel";
import { ORIGEM_COMPRA, ORIGEM_COMPRA_CANCELADA } from "@/lib/estoque/origens";
import {
  dentroDoPrazoDeDesfazer,
  foraDoPrazoDeDesfazer,
  podeDesfazer,
} from "@/lib/desfazer/prazo";

export interface UltimaCompraDoProduto {
  productId: string;
  unitPrice: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  suggested: Prisma.Decimal | null;
  purchaseDate: Date;
}

export const ComprasService = {
  async list(tenantId: string) {
    const db = getTenantPrisma(tenantId);
    return db.purchase.findMany({
      // O produto vem junto para a lista poder abrir os itens sem outra
      // consulta — conferir "o que veio nesta compra" era o buraco da tela.
      include: {
        supplier: true,
        items: { include: { product: { select: { name: true } } } },
        // A conta da compra: pago ou a pagar, e até quando.
        expenses: {
          where: { origem: "COMPRA", deletedAt: null },
          select: { id: true, status: true, dueDate: true, paidDate: true, amount: true },
          take: 1,
        },
      },
      orderBy: { purchaseDate: "desc" },
      take: 100,
    });
  },

  /**
   * O último preço PAGO por produto, para a tela de compra lembrar por ela.
   *
   * Devolve `unitPrice`, e não `unitCost`, e a diferença é o ponto todo: o
   * `unitCost` já inclui o rateio do frete (`custoRealUnitario`), então é o preço
   * negociado MAIS o caminhão do comprador. Exibir isso ao lado do preço que ele
   * está digitando — e ao lado do boletim, que é preço na praça, antes de
   * qualquer transporte — faria toda comparação apontar "você pagou acima", todo
   * dia, para todo mundo. O viés seria constante e invisível.
   *
   * `DISTINCT ON` no molde de `VendasService.precosSugeridosDaCompra`. O `JOIN`
   * com `purchases` é obrigatório: `purchase_items` não tem `deletedAt` próprio,
   * então sem ele uma compra excluída continuaria ditando o "último preço".
   */
  /**
   * A ÚLTIMA compra de cada produto, com tudo que as telas tiram dela: o preço
   * pago (margem na Compra e no PDV) e o sugerido/custo (preço inicial no PDV).
   *
   * Uma consulta só para os dois usos: o PDV rodava esta mesma varredura duas
   * vezes por carga, uma para cada número.
   */
  async ultimaCompraPorProduto(tenantId: string): Promise<UltimaCompraDoProduto[]> {
    return prisma.$queryRaw<UltimaCompraDoProduto[]>`
      SELECT DISTINCT ON (pi."productId")
             pi."productId", pi."unitPrice", pi."unitCost",
             pi."suggestedSalePrice" AS suggested, p."purchaseDate"
      FROM purchase_items pi
      JOIN purchases p ON p.id = pi."purchaseId"
      WHERE pi."tenantId" = ${tenantId} AND p."deletedAt" IS NULL AND p."cancelledAt" IS NULL
      ORDER BY pi."productId", p."purchaseDate" DESC, pi."createdAt" DESC
    `;
  },

  async ultimosPrecosPagos(
    tenantId: string,
    jaLidas?: UltimaCompraDoProduto[],
  ): Promise<Record<string, { unitPrice: number; purchaseDate: Date }>> {
    const rows = jaLidas ?? (await this.ultimaCompraPorProduto(tenantId));
    const mapa: Record<string, { unitPrice: number; purchaseDate: Date }> = {};
    for (const r of rows) {
      const valor = Number(money(r.unitPrice));
      if (valor > 0) mapa[r.productId] = { unitPrice: valor, purchaseDate: r.purchaseDate };
    }
    return mapa;
  },

  /** Compra já gravada com esta chave (o `include` casa com o da transação). */
  async porChaveDeIdempotencia(tenantId: string, chave: string) {
    return getTenantPrisma(tenantId).purchase.findFirst({
      where: { idempotencyKey: chave },
      include: { items: true },
    });
  },

  async registrarCompra(input: CompraInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);

    // Mesmo molde de `VendasService.registrarVenda`. O toque duplo em "Salvar
    // compra" (ou a retentativa depois de um timeout em que o servidor gravou)
    // dava entrada no estoque, nas caixas e no frete DUAS vezes. O atalho pega
    // a retentativa depois da primeira; o índice único pega a corrida.
    if (input.idempotencyKey) {
      const jaExiste = await this.porChaveDeIdempotencia(ctx.tenantId, input.idempotencyKey);
      if (jaExiste) return jaExiste;
    }

    const productIds = [...new Set(input.items.map((i) => i.productId))];

    // Sem o módulo `caixas`, a compra não mexe no livro-razão de caixas — o
    // mesmo gate da venda (`registrarVenda`). A tela esconde o bloco "chegou
    // em caixa plástica" nesse caso; aqui é a barreira de verdade, contra
    // POST montado à mão ou tela velha aberta antes de o plano mudar. Zerar em
    // vez de recusar: a compra em si é legítima, só o controle não é do plano.
    const caixasHabilitado = isModuleEnabled(ctx.session.modules, "caixas");
    const caixasRecebidas = caixasHabilitado ? (input.caixasRecebidas ?? 0) : 0;
    const caixasQuebradas = caixasHabilitado ? (input.caixasQuebradas ?? 0) : 0;
    if (caixasQuebradas > caixasRecebidas) {
      throw new BusinessRuleError(
        "As caixas quebradas não podem passar do total de caixas recebidas.",
      );
    }
    // Saldo lido FORA da transação, como em `registrarVenda`: `registrarInTx`
    // valida o movimento contra ele e não pode reabrir conexão no meio.
    const fornecedorNome = input.supplierId
      ? ((
          await db.supplier.findFirst({
            where: { id: input.supplierId },
            select: { name: true },
          })
        )?.name ?? null)
      : null;

    const lineTotals = input.items.map((i) => mul(i.quantity, i.unitPrice));
    // As quantidades vão junto para a compra de valor zero (consignação,
    // bonificação): sem valor para ratear, o frete era descartado do custo.
    const freightShares = FinancialCalc.ratearFrete(
      lineTotals,
      input.freight,
      input.items.map((i) => i.quantity),
    );
    // Soma das linhas JÁ arredondadas, como a venda (`lib/venda/total.ts`): o
    // total cru dava R$ 2,23 para dois itens gravados como R$ 1,12 cada, e a
    // conta da compra não fechava com os itens nem com o relatório por item.
    const totalAmount = money(add(...lineTotals.map((l) => money(l)), input.freight));

    // A conta da compra. Sem `pagamento` (cliente antigo da API, testes), a
    // compra é tratada como paga na hora — o que o fluxo de caixa sempre supôs.
    const pagamento = input.pagamento ?? { status: "PAGO" as const };
    const purchaseDate = parseFormDateTz(input.purchaseDate);
    const vencimento =
      pagamento.status === "PENDENTE" && pagamento.dueDate
        ? parseFormDateTz(pagamento.dueDate)
        : null;
    if (pagamento.status === "PENDENTE") {
      if (!vencimento) throw new BusinessRuleError("Informe até quando vai pagar a compra.");
      if (vencimento.getTime() < purchaseDate.getTime()) {
        throw new BusinessRuleError("O vencimento não pode ser antes da data da compra.");
      }
    }

    const itemsData = input.items.map((i, idx) => ({
      tenantId: ctx.tenantId,
      productId: i.productId,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      recipientType: i.recipientType ?? null,
      freightShare: freightShares[idx],
      unitCost: FinancialCalc.custoRealUnitario(i.quantity, i.unitPrice, freightShares[idx]),
      lineTotal: money(lineTotals[idx]),
      suggestedSalePrice: i.suggestedSalePrice ?? null,
    }));

    const gravar = () =>
      db.$transaction(async (tx) => {
        // `FOR SHARE` no fornecedor e nos produtos: a exclusão de um ou de outro
        // trava a mesma linha (`FOR UPDATE`) para conferir conta a pagar e
        // saldo. Sem o lock, a compra gravada no meio da exclusão deixava
        // dívida com fornecedor excluído ou estoque em produto excluído.
        if (input.supplierId) {
          const supplier = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM suppliers
            WHERE "tenantId" = ${ctx.tenantId} AND id = ${input.supplierId}
              AND active = true AND "deletedAt" IS NULL
            FOR SHARE
          `;
          if (supplier.length === 0) throw new NotFoundError("Fornecedor nao encontrado");
        }

        const products = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM products
          WHERE "tenantId" = ${ctx.tenantId} AND id = ANY(${productIds}::text[])
            AND active = true AND "deletedAt" IS NULL
          ORDER BY id
          FOR SHARE
        `;
        if (products.length !== productIds.length) {
          throw new NotFoundError("Um ou mais produtos nao foram encontrados");
        }

        const purchase = await tx.purchase.create({
          data: {
            tenantId: ctx.tenantId,
            supplierId: input.supplierId || null,
            purchaseDate,
            freight: input.freight,
            totalAmount,
            notes: input.notes ?? null,
            idempotencyKey: input.idempotencyKey ?? null,
            items: { create: itemsData },
          },
          include: { items: true },
        });

        await tx.stockMovement.createMany({
          data: purchase.items.map((it) => ({
            tenantId: ctx.tenantId,
            productId: it.productId,
            type: "ENTRADA" as const,
            quantity: it.quantity,
            unitCost: it.unitCost,
            sourceType: ORIGEM_COMPRA,
            sourceId: purchase.id,
            movedAt: purchase.purchaseDate,
          })),
        });

        // Caixas plásticas que vieram com a mercadoria, na MESMA transação.
        // Antes era um segundo lançamento em outra tela — e a metade esquecida
        // fazia o saldo de caixas divergir do que existe no box.
        if (caixasRecebidas > 0) {
          await CaixasService.registrarInTx(
            tx,
            {
              type: "ENTRADA",
              quantity: caixasRecebidas,
              brokenQty: caixasQuebradas,
              dirty: input.caixasSujas ?? false,
              supplierName: fornecedorNome,
              movementDate: purchase.purchaseDate.toISOString(),
              notes: "Entrada automática pela compra",
              // O vínculo é o que deixa o cancelamento da compra achar as caixas.
              purchaseId: purchase.id,
            },
            ctx,
          );
        }

        // Toda compra vira UMA despesa no valor total, ligada ao fornecedor, na
        // mesma transação: compra sem a conta a pagar dela seria dinheiro devido
        // que não aparece em lugar nenhum. `origem = COMPRA` é o que a tira do
        // lucro (o custo já está no CMV pelo `unitCost` das entradas) e a mantém
        // em Contas a Pagar e no fluxo de caixa. O índice único parcial
        // `expenses_compra_unica` garante uma por compra.
        //
        // Compra de valor zero (bonificação, consignação) não deve nada a
        // ninguém: não gera conta — uma linha de R$ 0,00 em Contas a Pagar só
        // poluiria a lista. O backfill da migration segue a mesma regra.
        const categoria = await tx.expenseCategory.findFirst({
          where: { tenantId: ctx.tenantId, name: COMPRA_EXPENSE_CATEGORY, deletedAt: null },
          select: { id: true },
        });
        const freteNaDescricao = toDecimal(input.freight).greaterThan(0)
          ? ` (inclui frete ${formatBRL(input.freight)})`
          : "";
        const despesa = totalAmount.lessThanOrEqualTo(0)
          ? null
          : await tx.expense.create({
              data: {
                tenantId: ctx.tenantId,
                origem: "COMPRA",
                purchaseId: purchase.id,
                supplierId: purchase.supplierId,
                categoryId: categoria?.id ?? null,
                description:
                  (fornecedorNome ? `Compra — ${fornecedorNome}` : "Compra sem fornecedor") +
                  freteNaDescricao,
                amount: totalAmount,
                type: "VARIAVEL",
                recurring: false,
                status: pagamento.status,
                paymentMethod: pagamento.paymentMethod ?? null,
                dueDate: vencimento ?? purchaseDate,
                paidDate: pagamento.status === "PAGO" ? purchaseDate : null,
              },
              select: { id: true, status: true },
            });

        await audit(
          {
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            actorEmail: ctx.session.email,
            action: "CREATE",
            entity: "Purchase",
            entityId: purchase.id,
            newData: {
              totalAmount: totalAmount.toString(),
              items: purchase.items.length,
              expenseId: despesa?.id ?? null,
              pagamento: despesa?.status ?? null,
            },
            ip: ctx.ip,
          },
          tx,
        );

        return purchase;
      });

    try {
      return await gravar();
    } catch (e) {
      // Dois envios simultâneos com a mesma chave: o segundo INSERT espera o
      // primeiro commitar e esbarra no índice único. Só ESSA colisão vira
      // "já gravada" — outra unicidade qualquer continua sendo erro.
      if (input.idempotencyKey && ehConflitoDeIdempotencia(e)) {
        const existente = await this.porChaveDeIdempotencia(ctx.tenantId, input.idempotencyKey);
        if (existente) return existente;
      }
      throw e;
    }
  },

  /**
   * A compra ainda pode ser cancelada? A tela usa para mostrar o botão; o
   * serviço refaz a conta (e confere o estoque) na hora de cancelar.
   */
  podeCancelar(compra: { createdAt: Date; cancelledAt: Date | null }, agora = new Date()): boolean {
    return !compra.cancelledAt && dentroDoPrazoDeDesfazer(compra.createdAt, agora);
  },

  /**
   * Cancela uma compra lançada errada — quantidade, preço ou fornecedor —, para
   * ela ser lançada de novo do jeito certo. Mesma regra de desfazer da venda
   * (`src/lib/desfazer/prazo.ts`): só o dono, até 24 h depois do registro.
   *
   * Desfaz, na mesma transação, tudo o que `registrarCompra` gravou:
   *
   *  1. marca a compra como cancelada (ela FICA na base e sai dos totais);
   *  2. tira a mercadoria do estoque com um AJUSTE negativo ligado à compra
   *     (`ORIGEM_COMPRA_CANCELADA`) — e o par entrada/estorno sai do custo
   *     médio (`sqlCustoEstoque`): o preço digitado errado não fica na média;
   *  3. estorna as caixas plásticas que chegaram com ela;
   *  4. cancela a conta da compra, paga ou a pagar: a dívida (ou o pagamento)
   *     era da compra errada. A compra certa, relançada, gera a dela.
   *
   * Recusa se, depois dela, os produtos já tiveram venda, baixa ou ajuste: o
   * custo desta compra já foi gravado nesses movimentos (e no CMV das vendas),
   * e a compra deixou de ser um lançamento isolado que se possa desfazer.
   */
  async cancelarCompra(input: CancelarCompraInput, ctx: TenantCtx) {
    // Mesma barreira explícita de `VendasService.cancelarVenda`.
    if (!podeDesfazer(ctx.session.role)) {
      throw new ForbiddenError("Só o responsável pela empresa pode cancelar uma compra.");
    }

    const db = getTenantPrisma(ctx.tenantId);
    const compra = await db.purchase.findFirst({
      where: { id: input.id },
      include: { items: true },
    });
    if (!compra) throw new NotFoundError("Compra não encontrada");
    if (compra.cancelledAt) throw new BusinessRuleError("Esta compra já foi cancelada.");
    if (!dentroDoPrazoDeDesfazer(compra.createdAt)) {
      throw new BusinessRuleError(foraDoPrazoDeDesfazer("cancelar esta compra"));
    }

    // A mesma mercadoria pode vir em duas linhas da compra.
    const trouxe = new Map<string, Prisma.Decimal>();
    for (const it of compra.items) {
      trouxe.set(it.productId, add(trouxe.get(it.productId) ?? 0, it.quantity));
    }
    const productIds = [...trouxe.keys()].sort();

    return db.$transaction(async (tx) => {
      // Guarda otimista contra o clique duplo, como no cancelamento de venda.
      const marcada = await tx.purchase.updateMany({
        where: { id: compra.id, cancelledAt: null },
        data: { cancelledAt: new Date(), cancelledReason: input.motivo || null },
      });
      if (marcada.count !== 1) throw new BusinessRuleError("Esta compra já foi cancelada.");

      // Trava os produtos antes de ler o saldo — o padrão da venda. Sem filtro
      // de `active`/`deletedAt`: o produto desativado depois da compra continua
      // com a mercadoria dela no estoque.
      const produtos = await tx.$queryRaw<{ id: string; name: string }[]>`
        SELECT id, name FROM products
        WHERE "tenantId" = ${ctx.tenantId} AND id = ANY(${productIds}::text[])
        ORDER BY id
        FOR UPDATE
      `;
      const nomes = new Map(produtos.map((p) => [p.id, p.name]));

      // Nada pode ter usado o custo desta compra. Toda saída (venda, quebra,
      // doação) e todo ajuste gravado DEPOIS dela levou a média com o preço
      // dela — e esse custo fica gravado no movimento e na venda. Tirar a
      // compra do repasse depois disso deixaria a venda com o CMV do preço
      // errado, para sempre. Conferir só o saldo não basta: com estoque de
      // antes, vender 5 de 15 passava, e o lucro do dia ficava errado.
      const usados = await tx.$queryRaw<{ productId: string }[]>`
        SELECT DISTINCT m."productId"
        FROM stock_movements m
        WHERE m."tenantId" = ${ctx.tenantId}
          AND m."productId" = ANY(${productIds}::text[])
          AND m.type <> 'ENTRADA'
          AND m."createdAt" > (
            SELECT MIN(e."createdAt") FROM stock_movements e
            WHERE e."tenantId" = ${ctx.tenantId}
              AND e."sourceType" = ${ORIGEM_COMPRA} AND e."sourceId" = ${compra.id}
          )
      `;
      if (usados.length > 0) {
        const nome = nomes.get(usados[0]!.productId) ?? "um produto";
        throw new BusinessRuleError(
          `Depois desta compra já houve venda, baixa ou ajuste de ${nome}: o custo dela já ` +
            "foi usado, e a compra não pode mais ser cancelada.",
        );
      }

      const { saldo } = await saldoECustoMedio(tx, ctx.tenantId, productIds);
      for (const [productId, quantidade] of trouxe) {
        const temAgora = saldo.get(productId) ?? toDecimal(0);
        if (passaDoEstoque(temAgora, quantidade)) {
          throw new BusinessRuleError(
            `${nomes.get(productId) ?? "Um produto"} tem ${formatQty(temAgora)} em estoque e a ` +
              `compra trouxe ${formatQty(quantidade)}: parte já foi vendida ou baixada, e a ` +
              "compra não pode mais ser cancelada.",
          );
        }
      }

      await tx.stockMovement.createMany({
        data: compra.items.map((it) => ({
          tenantId: ctx.tenantId,
          productId: it.productId,
          type: "AJUSTE" as const,
          quantity: toDecimal(it.quantity).negated(),
          unitCost: it.unitCost,
          reason: "Estorno da compra cancelada",
          sourceType: ORIGEM_COMPRA_CANCELADA,
          sourceId: compra.id,
        })),
      });

      const entradasDeCaixas = await tx.plasticCrateMovement.findMany({
        where: { purchaseId: compra.id, type: "ENTRADA", quantity: { gt: 0 } },
        select: {
          quantity: true,
          brokenQty: true,
          dirty: true,
          supplierName: true,
          movementDate: true,
        },
      });
      const caixasEstornadas = await CaixasService.estornarEntradasDaCompraInTx(
        tx,
        compra.id,
        entradasDeCaixas,
        ctx,
      );

      const conta = await tx.expense.updateMany({
        where: { purchaseId: compra.id, origem: "COMPRA" },
        data: { deletedAt: new Date() },
      });

      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "PURCHASE_CANCELLED",
          entity: "Purchase",
          entityId: compra.id,
          oldData: { totalAmount: compra.totalAmount.toString(), items: compra.items.length },
          newData: {
            motivo: input.motivo ?? null,
            caixasEstornadas,
            contaCancelada: conta.count > 0,
          },
          ip: ctx.ip,
        },
        tx,
      );

      return { id: compra.id, caixasEstornadas, contaCancelada: conta.count > 0 };
    });
  },
};

/** O P2002 é o do índice `(tenantId, idempotencyKey)` de `purchases`? */
function ehConflitoDeIdempotencia(e: unknown): boolean {
  const err = e as { code?: unknown; meta?: { target?: unknown } } | null;
  if (err?.code !== "P2002") return false;
  const alvo = err.meta?.target;
  if (typeof alvo === "string") return alvo === "purchases_tenantId_idempotencyKey_key";
  return Array.isArray(alvo) && alvo.map(String).includes("idempotencyKey");
}
