import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { ProdutosService, SOURCE_ESTOQUE_INICIAL } from "@/lib/services/produtos.service";
import { EstoqueService } from "@/lib/services/estoque.service";
import { ComprasService } from "@/lib/services/compras.service";
import { VendasService } from "@/lib/services/vendas.service";
import { DashboardService } from "@/lib/services/dashboard.service";
import { isoDateTz } from "@/lib/tz";
import { prefixoDaEmpresa } from "@/lib/imagem/formato";
import { produtoSchema } from "@/lib/validations/produto";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";

/**
 * Cadastro de produto pelo modal do Estoque: estoque inicial com custo, preço,
 * alerta e foto — e de quem a foto pode ser.
 */

const tenants: string[] = [];
let tenantId = "";
let outroTenantId = "";
let ctx = makeCtx("");
const catalogoKey = `catalogo/${randomUUID()}.webp`;
const chavesDoCatalogo = [catalogoKey];

beforeAll(async () => {
  tenantId = await createTestTenant("PRODUTO CADASTRO");
  outroTenantId = await createTestTenant("PRODUTO OUTRO");
  tenants.push(tenantId, outroTenantId);
  ctx = makeCtx(tenantId);
  await prisma.catalogoImagem.create({
    data: { nome: "Tomate", slug: "tomate", imageKey: catalogoKey },
  });
});

afterAll(async () => {
  await prisma.catalogoImagem.deleteMany({ where: { imageKey: { in: chavesDoCatalogo } } });
  await cleanupTenants(tenants);
});

const base = { saleUnit: "CAIXA" as const, active: true };

describe("estoque inicial", () => {
  it("vira ENTRADA com o custo informado, na mesma gravação do produto", async () => {
    const p = await ProdutosService.create(
      {
        ...base,
        name: "Tomate italiano",
        salePrice: 120,
        minStock: 3,
        estoqueInicial: 12,
        custoInicial: 80,
      },
      ctx,
    );
    expect(Number(p.salePrice)).toBe(120);
    expect(Number(p.minStock)).toBe(3);

    const mov = await prisma.stockMovement.findFirstOrThrow({ where: { productId: p.id } });
    expect(mov.type).toBe("ENTRADA");
    expect(mov.sourceType).toBe(SOURCE_ESTOQUE_INICIAL);
    expect(Number(mov.quantity)).toBe(12);
    expect(Number(mov.unitCost)).toBe(80);

    const pos = (await EstoqueService.getPositions(tenantId)).find((x) => x.productId === p.id)!;
    expect(Number(pos.quantity)).toBe(12);
    expect(Number(pos.avgCost)).toBe(80);
    expect(Number(pos.value)).toBe(960);
    expect(Number(pos.minStock)).toBe(3);
  });

  it("sem estoque inicial, nenhum movimento é criado", async () => {
    const p = await ProdutosService.create({ ...base, name: "Alface" }, ctx);
    expect(await prisma.stockMovement.count({ where: { productId: p.id } })).toBe(0);
  });

  it("estoque inicial sem custo é recusado (schema e serviço)", async () => {
    const r = produtoSchema.safeParse({ ...base, name: "Pepino", estoqueInicial: 5 });
    expect(r.success).toBe(false);
    await expect(
      ProdutosService.create({ ...base, name: "Pepino", estoqueInicial: 5 }, ctx),
    ).rejects.toThrow(/custou/);
    expect(await prisma.product.count({ where: { tenantId, name: "Pepino" } })).toBe(0);
  });

  it("com a opção, grava a quantidade e deixa o custo nulo", async () => {
    const r = produtoSchema.safeParse({
      ...base,
      name: "Uva",
      estoqueInicial: 60,
      semCustoInicial: true,
    });
    expect(r.success).toBe(true);
    const p = await ProdutosService.create(
      { ...base, name: "Uva", estoqueInicial: 60, semCustoInicial: true },
      ctx,
    );
    const mov = await prisma.stockMovement.findFirstOrThrow({ where: { productId: p.id } });
    expect(mov.sourceType).toBe(SOURCE_ESTOQUE_INICIAL);
    expect(Number(mov.quantity)).toBe(60);
    expect(mov.unitCost).toBeNull();

    const pos = (await EstoqueService.getPositions(tenantId)).find((x) => x.productId === p.id)!;
    expect(Number(pos.quantity)).toBe(60);
    expect(pos.avgCost).toBeNull();
    expect(Number(pos.value)).toBe(0);
    expect(Number(pos.quantidadeSemCusto)).toBe(60);
  });
});

describe("estoque sem custo não entra no lucro", () => {
  it("compra seguinte não herda a quantidade, e a venda dela fica fora do CMV", async () => {
    const p = await ProdutosService.create(
      { ...base, name: "Banana", estoqueInicial: 60, semCustoInicial: true },
      ctx,
    );
    await ComprasService.registrarCompra(
      {
        supplierId: null,
        purchaseDate: isoDateTz(),
        freight: 0,
        items: [{ productId: p.id, quantity: 10, unitPrice: 20 }],
      },
      ctx,
    );

    const antes = (await EstoqueService.getPositions(tenantId)).find((x) => x.productId === p.id)!;
    expect(Number(antes.quantity)).toBe(70);
    expect(Number(antes.avgCost)).toBe(20);
    expect(Number(antes.value)).toBe(200);
    expect(Number(antes.quantidadeSemCusto)).toBe(60);

    await EstoqueService.atualizarCheckpoints(tenantId, new Date());
    const comCheckpoint = (await EstoqueService.getPositions(tenantId)).find(
      (x) => x.productId === p.id,
    )!;
    expect(Number(comCheckpoint.avgCost)).toBe(20);
    expect(Number(comCheckpoint.value)).toBe(200);

    const venda = await VendasService.registrarVenda(
      {
        paymentMethod: "DINHEIRO",
        items: [{ productId: p.id, quantity: 15, unitPrice: 30 }],
      },
      ctx,
    );
    expect(venda.items[0]!.unitCostAtSale).toBeNull();
    expect(Number(venda.items[0]!.quantidadeComCusto)).toBe(0);

    const depois = (await EstoqueService.getPositions(tenantId)).find((x) => x.productId === p.id)!;
    expect(Number(depois.quantity)).toBe(55);
    expect(Number(depois.value)).toBe(200);
    expect(Number(depois.quantidadeSemCusto)).toBe(45);

    const painel = await DashboardService.calcularSummary(tenantId, ctx.session.modules);
    expect(Number(painel.mesVendi)).toBe(450);
    expect(Number(painel.cmvMes)).toBe(0);
    expect(Number(painel.vendasSemCustoMes)).toBe(450);
    expect(painel.vendasSemCusto).toBe(1);
    expect(Number(painel.lucroBrutoMes)).toBe(0);
    expect(Number(painel.margemLiquidaMes)).toBe(0);
  });
});

describe("foto do produto", () => {
  it("aceita foto da própria empresa e do banco da plataforma", async () => {
    const propria = `${prefixoDaEmpresa(tenantId)}${randomUUID()}.webp`;
    const a = await ProdutosService.create({ ...base, name: "Cenoura", imageKey: propria }, ctx);
    expect(a.imageKey).toBe(propria);
    const b = await ProdutosService.create({ ...base, name: "Tomate", imageKey: catalogoKey }, ctx);
    expect(b.imageKey).toBe(catalogoKey);
  });

  it("recusa a foto de OUTRA empresa e chave inventada", async () => {
    const alheia = `${prefixoDaEmpresa(outroTenantId)}${randomUUID()}.webp`;
    await expect(
      ProdutosService.create({ ...base, name: "Batata", imageKey: alheia }, ctx),
    ).rejects.toThrow(/Foto inválida/);
    await expect(
      ProdutosService.create({ ...base, name: "Batata", imageKey: "catalogo/nao-existe.webp" }, ctx),
    ).rejects.toThrow(/Foto inválida/);
    await expect(
      ProdutosService.create(
        { ...base, name: "Batata", imageKey: `${prefixoDaEmpresa(tenantId)}../x.webp` },
        ctx,
      ),
    ).rejects.toThrow(/Foto inválida/);
  });

  it("foto do banco desativada continua valendo para quem já a usava", async () => {
    const key = `catalogo/${randomUUID()}.webp`;
    chavesDoCatalogo.push(key);
    await prisma.catalogoImagem.create({ data: { nome: "Velha", slug: "velha", imageKey: key } });
    const p = await ProdutosService.create({ ...base, name: "Chuchu", imageKey: key }, ctx);
    await prisma.catalogoImagem.update({ where: { imageKey: key }, data: { ativo: false } });

    const editado = await ProdutosService.update(
      { ...base, id: p.id, name: "Chuchu verde", imageKey: key },
      ctx,
    );
    expect(editado.imageKey).toBe(key);
    // Mas um produto NOVO não pode mais escolhê-la.
    await expect(
      ProdutosService.create({ ...base, name: "Chuchu 2", imageKey: key }, ctx),
    ).rejects.toThrow(/Foto inválida/);
  });
});
