import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { audit } from "@/lib/audit";
import { BusinessRuleError, NotFoundError } from "@/lib/http/app-error";
import type { ProdutoInput, ProdutoUpdateInput } from "@/lib/validations/produto";
import type { TenantCtx } from "@/lib/http/with-action";
import { ProdutoImagemService } from "./produto-imagem.service";
import { CotacoesService } from "./cotacoes.service";
import { describeError, logger } from "@/lib/logger";
import { formatQty } from "@/lib/format";
import { Prisma } from "@prisma/client";
import { saldoECustoMedio } from "./estoque.service";
import { ORIGEM_PRODUTO_EXCLUIDO } from "@/lib/estoque/origens";
import { HORAS_PARA_DESFAZER } from "@/lib/desfazer/prazo";
import { isModuleEnabled } from "@/lib/plan/modules";

/** `sourceType` do movimento de ENTRADA gravado pelo cadastro do produto. */
export const SOURCE_ESTOQUE_INICIAL = "ESTOQUE_INICIAL";

/** O produto já aparece em algum lançamento (estoque, compra ou venda)? */
async function temHistorico(tenantId: string, productId: string): Promise<boolean> {
  const db = getTenantPrisma(tenantId);
  const [movimento, compra, venda] = await Promise.all([
    db.stockMovement.findFirst({ where: { productId }, select: { id: true } }),
    db.purchaseItem.findFirst({ where: { productId }, select: { id: true } }),
    db.saleItem.findFirst({ where: { productId }, select: { id: true } }),
  ]);
  return Boolean(movimento || compra || venda);
}

export const ProdutosService = {
  /**
   * Só os ATIVOS, só o que a frente de caixa mostra. O PDV usava `list`, que
   * traz inativos e todas as colunas, para depois filtrar e jogar fora.
   */
  async ativosParaVenda(tenantId: string) {
    return getTenantPrisma(tenantId).product.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, saleUnit: true, minStock: true, imageKey: true, salePrice: true },
    });
  },

  /** Nomes dos produtos ativos — para casar notícia e cotação com o que a empresa vende. */
  async nomesAtivos(tenantId: string): Promise<string[]> {
    const rows = await getTenantPrisma(tenantId).product.findMany({
      where: { active: true },
      select: { name: true },
    });
    return rows.map((r) => r.name);
  },

  async list(tenantId: string, search?: string) {
    const db = getTenantPrisma(tenantId);
    return db.product.findMany({
      where: search
        ? { name: { contains: search, mode: "insensitive" } }
        : undefined,
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
  },

  /**
   * O produto já tem lançamento? A tela de edição usa para travar a unidade
   * de venda — a mesma regra que `update` aplica no servidor.
   */
  temHistorico(tenantId: string, productId: string): Promise<boolean> {
    return temHistorico(tenantId, productId);
  },

  async get(tenantId: string, id: string) {
    const db = getTenantPrisma(tenantId);
    const product = await db.product.findFirst({ where: { id } });
    if (!product) throw new NotFoundError("Produto não encontrado");
    return product;
  },

  /**
   * Cadastro do produto — e, se veio, o estoque que já está no box.
   *
   * O estoque inicial é um movimento de ENTRADA comum (o saldo continua sendo
   * só a soma do livro-razão), com o custo informado pelo dono: é ele que vira
   * o custo médio e, daí, o CMV das primeiras vendas. Produto e entrada na MESMA
   * transação, com a auditoria dentro: produto sem a entrada que o dono digitou
   * seria estoque sumindo sem aviso.
   */
  async create(input: ProdutoInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const imageKey = await ProdutoImagemService.validarChave(ctx.tenantId, input.imageKey);
    const estoqueInicial = input.estoqueInicial ?? 0;
    if (estoqueInicial > 0 && input.custoInicial == null) {
      throw new BusinessRuleError("Informe quanto custou cada unidade do estoque inicial.");
    }

    const criado = await db.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          tenantId: ctx.tenantId,
          name: input.name,
          saleUnit: input.saleUnit,
          qtyPerRecipient: input.qtyPerRecipient ?? null,
          recipientType: input.recipientType ?? null,
          sackCapacity: input.sackCapacity ?? null,
          salePrice: input.salePrice ?? null,
          minStock: input.minStock ?? null,
          imageKey,
          active: input.active,
        },
      });

      if (estoqueInicial > 0) {
        await tx.stockMovement.create({
          data: {
            tenantId: ctx.tenantId,
            productId: product.id,
            type: "ENTRADA",
            quantity: estoqueInicial,
            unitCost: input.custoInicial ?? 0,
            reason: "Estoque inicial (cadastro do produto)",
            sourceType: SOURCE_ESTOQUE_INICIAL,
            sourceId: product.id,
          },
        });
      }

      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "CREATE",
          entity: "Product",
          entityId: product.id,
          newData: {
            ...product,
            ...(estoqueInicial > 0 ? { estoqueInicial, custoInicial: input.custoInicial } : {}),
          },
          ip: ctx.ip,
        },
        tx,
      );
      return product;
    });

    // Fora da transação: o produto já está gravado, e o vínculo com a cotação
    // é conveniência — falhar aqui não pode desfazer o cadastro. Só com o
    // módulo: cadastro de produto é núcleo, e quem não contratou cotações não
    // tem por que pagar a leitura do boletim nem ganhar vínculo nele.
    if (isModuleEnabled(ctx.session.modules, "cotacoes")) {
      await CotacoesService.autoVincularIdenticos(ctx.tenantId).catch((e) =>
        logger.error(
          { err: describeError(e), tenantId: ctx.tenantId },
          "Falha no vínculo automático de cotações",
        ),
      );
    }
    return criado;
  },

  async update(input: ProdutoUpdateInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const before = await db.product.findFirst({ where: { id: input.id } });
    if (!before) throw new NotFoundError("Produto não encontrado");

    // Nenhum movimento, compra ou venda guarda a unidade: todos leem a do
    // produto vivo. Trocar CAIXA → KG num produto com histórico reinterpretava
    // o livro-razão inteiro — 50 caixas em estoque viravam "50 kg", o custo
    // por caixa virava custo por quilo, e o fiado passado era relido em kg.
    if (input.saleUnit !== before.saleUnit && (await temHistorico(ctx.tenantId, before.id))) {
      throw new BusinessRuleError(
        "Este produto já tem compras, vendas ou movimento de estoque, e a unidade de venda " +
          "não pode mudar: o histórico passaria a ser lido na unidade nova. Cadastre um " +
          "produto novo para vender na outra unidade.",
      );
    }

    const imageKey = await ProdutoImagemService.validarChave(
      ctx.tenantId,
      input.imageKey,
      before.imageKey,
    );

    const product = await db.product.update({
      where: { id: input.id },
      data: {
        name: input.name,
        saleUnit: input.saleUnit,
        qtyPerRecipient: input.qtyPerRecipient ?? null,
        recipientType: input.recipientType ?? null,
        sackCapacity: input.sackCapacity ?? null,
        salePrice: input.salePrice ?? null,
        minStock: input.minStock ?? null,
        imageKey,
        active: input.active,
      },
    });
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "UPDATE",
      entity: "Product",
      entityId: product.id,
      oldData: before,
      newData: product,
      ip: ctx.ip,
    });
    // Foto trocada ou removida: a antiga da empresa sai do bucket (best-effort,
    // depois de gravar — falhar aqui não pode desfazer a edição).
    if (before.imageKey && before.imageKey !== imageKey) {
      await ProdutoImagemService.descartarDaEmpresa(ctx.tenantId, before.imageKey);
    }
    return product;
  },

  /**
   * Exclui (soft delete) o produto — também com saldo, depois da confirmação
   * na tela.
   *
   * A posição de estoque, o valor em estoque e os relatórios ignoram produto
   * excluído. Para o valor da mercadoria não sumir do painel sem registro, o
   * saldo é baixado no livro-razão (AJUSTE negativo, origem manual) na mesma
   * transação, e conta como perda do mês.
   *
   * Trava a linha do produto, como a venda: uma venda ou compra em andamento
   * espera, e o saldo lido aqui é o definitivo.
   */
  async remove(id: string, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    await db.$transaction(async (tx) => {
      const travado = await tx.$queryRaw<{ id: string; name: string }[]>`
        SELECT id, name FROM products
        WHERE "tenantId" = ${ctx.tenantId} AND id = ${id} AND "deletedAt" IS NULL
        FOR UPDATE
      `;
      const produto = travado[0];
      if (!produto) throw new NotFoundError("Produto não encontrado");

      // Saldo que sobrou sai pelo livro-razão (acerto para baixo, pelo custo
      // médio da hora) — entra nas perdas do mês em vez de sumir sem registro.
      const { saldo: saldos, custo: custos } = await saldoECustoMedio(tx, ctx.tenantId, [id]);
      const saldo = saldos.get(id) ?? new Prisma.Decimal(0);
      if (saldo.greaterThan(0)) {
        await tx.stockMovement.create({
          data: {
            tenantId: ctx.tenantId,
            productId: id,
            type: "AJUSTE",
            quantity: saldo.neg(),
            unitCost: custos.get(id) ?? new Prisma.Decimal(0),
            reason: `Baixa do saldo (${formatQty(saldo)}) na exclusão do produto`,
            sourceType: ORIGEM_PRODUTO_EXCLUIDO,
          },
        });
      }

      // Venda ainda cancelável devolveria a mercadoria a um produto excluído —
      // estoque que nenhuma tela mostra e nenhum ajuste alcança. Espera o prazo.
      const vendaCancelavel = await tx.saleItem.findFirst({
        where: {
          productId: id,
          sale: {
            cancelledAt: null,
            deletedAt: null,
            createdAt: { gte: new Date(Date.now() - HORAS_PARA_DESFAZER * 3600_000) },
          },
        },
        select: { id: true },
      });
      if (vendaCancelavel) {
        throw new BusinessRuleError(
          `${produto.name} foi vendido nas últimas ${HORAS_PARA_DESFAZER} h, e essa venda ainda ` +
            "pode ser cancelada (a mercadoria voltaria ao estoque). Exclua depois desse prazo, " +
            "ou desative o produto agora.",
        );
      }

      const before = await tx.product.findFirst({ where: { id } });
      await tx.product.update({ where: { id }, data: { deletedAt: new Date() } });
      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "DELETE",
          entity: "Product",
          entityId: id,
          oldData: before,
          // O que saiu do estoque junto com o produto (vai para as perdas do mês).
          newData: {
            saldoBaixado: saldo.toString(),
            custoUnitario: (custos.get(id) ?? new Prisma.Decimal(0)).toString(),
          },
          ip: ctx.ip,
        },
        tx,
      );
    });
  },
};
