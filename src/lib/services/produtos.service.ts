import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { audit } from "@/lib/audit";
import { BusinessRuleError, NotFoundError } from "@/lib/http/app-error";
import type { ProdutoInput, ProdutoUpdateInput } from "@/lib/validations/produto";
import type { TenantCtx } from "@/lib/http/with-action";

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

  async create(input: ProdutoInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const product = await db.product.create({
      data: {
        tenantId: ctx.tenantId,
        name: input.name,
        saleUnit: input.saleUnit,
        qtyPerRecipient: input.qtyPerRecipient ?? null,
        recipientType: input.recipientType ?? null,
        sackCapacity: input.sackCapacity ?? null,
        active: input.active,
      },
    });
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "CREATE",
      entity: "Product",
      entityId: product.id,
      newData: product,
      ip: ctx.ip,
    });
    return product;
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

    const product = await db.product.update({
      where: { id: input.id },
      data: {
        name: input.name,
        saleUnit: input.saleUnit,
        qtyPerRecipient: input.qtyPerRecipient ?? null,
        recipientType: input.recipientType ?? null,
        sackCapacity: input.sackCapacity ?? null,
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
    return product;
  },

  async remove(id: string, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const before = await db.product.findFirst({ where: { id } });
    if (!before) throw new NotFoundError("Produto não encontrado");
    await db.product.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "DELETE",
      entity: "Product",
      entityId: id,
      oldData: before,
      ip: ctx.ip,
    });
  },
};
