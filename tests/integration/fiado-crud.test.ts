import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { FiadoService } from "@/lib/services/fiado.service";
import { VendasService } from "@/lib/services/vendas.service";
import { CaixasService } from "@/lib/services/caixas.service";
import { EstoqueService } from "@/lib/services/estoque.service";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";
import type { TenantCtx } from "@/lib/http/with-action";

/**
 * CRUD do fiado, com foco na exclusão — que não apaga só a conta: desfaz a
 * venda, devolve a mercadoria ao estoque e traz as caixas de volta. Se a
 * reversão falhar em qualquer uma dessas pontas, o sistema fecha com buraco.
 */
const uniq = () => Math.random().toString(36).slice(2, 8);
const tenants: string[] = [];
let tenantId = "";
let ctx: TenantCtx;
let produtoId = "";

/** Cria uma venda FIADO e devolve a conta gerada automaticamente. */
async function vendaFiada(opts: { qtd: number; preco: number; caixas?: number }) {
  const sale = await VendasService.registrarVenda(
    {
      customerName: `Cliente ${uniq()}`,
      paymentMethod: "FIADO",
      saleDate: new Date().toISOString(),
      plasticCrateQty: opts.caixas ?? 0,
      items: [
        {
          productId: produtoId,
          quantity: opts.qtd,
          unitPrice: opts.preco,
          ...(opts.caixas ? { recipientType: "PLASTICA" as const, crateQty: opts.caixas } : {}),
        },
      ],
    },
    ctx,
  );
  const conta = await prisma.creditAccount.findFirstOrThrow({ where: { saleId: sale.id } });
  return { sale, conta };
}

beforeAll(async () => {
  tenantId = await createTestTenant("FIADO CRUD");
  tenants.push(tenantId);
  ctx = makeCtx(tenantId);

  const produto = await prisma.product.create({
    data: { tenantId, name: `Coco ${uniq()}`, saleUnit: "UNIDADE", active: true },
  });
  produtoId = produto.id;

  // Estoque e caixas iniciais, para a venda ter de onde sair.
  await prisma.stockMovement.create({
    data: { tenantId, productId: produtoId, type: "ENTRADA", quantity: 1000, unitCost: 1 },
  });
  await CaixasService.registrar(
    { type: "ENTRADA", quantity: 500, movementDate: new Date().toISOString() },
    ctx,
  );
});

afterAll(async () => {
  await cleanupTenants(tenants);
});

describe("Venda no PDV com forma FIADO", () => {
  it("já lança a conta no fiado, sem passo manual", async () => {
    const { sale, conta } = await vendaFiada({ qtd: 10, preco: 2 });

    expect(conta.saleId).toBe(sale.id);
    expect(conta.status).toBe("EM_ABERTO");
    expect(Number(conta.totalAmount)).toBe(20);
    expect(Number(conta.paidAmount)).toBe(0);
  });

  it("a listagem do fiado traz produto, quantidade e preço da entrega", async () => {
    const { conta } = await vendaFiada({ qtd: 25, preco: 2 });

    const { contas } = await FiadoService.listOpen(tenantId, "EM_ABERTO");
    const linha = contas.find((c) => c.id === conta.id);
    expect(linha).toBeTruthy();
    expect(linha!.itens).toHaveLength(1);
    expect(Number(linha!.itens[0].quantity)).toBe(25);
    expect(Number(linha!.itens[0].unitPrice)).toBe(2);
    expect(Number(linha!.totalAmount)).toBe(50);
  });

  it("caixas plásticas da venda saem no livro-razão e contam no saldo do cliente", async () => {
    const { conta } = await vendaFiada({ qtd: 30, preco: 2, caixas: 30 });

    const detalhe = await FiadoService.get(tenantId, conta.id);
    expect(detalhe.plasticCrateQty).toBe(30);
    expect(detalhe.caixasComCliente).toBe(30);
  });
});

describe("Exclusão de lançamento de fiado", () => {
  it("desfaz a venda: conta some, estoque volta e caixas retornam", async () => {
    const antesEstoque = await EstoqueService.getTotalValue(tenantId);
    const saldoAntes = await CaixasService.getSaldo(tenantId);
    const { sale, conta } = await vendaFiada({ qtd: 40, preco: 2, caixas: 40 });

    await FiadoService.remove(conta.id, ctx);

    // A conta sai da listagem (soft delete + filtro do tenant-prisma).
    const { contas } = await FiadoService.listOpen(tenantId, "TODAS");
    expect(contas.some((c) => c.id === conta.id)).toBe(false);

    // A venda também: senão o faturamento contaria uma venda inexistente.
    const vendaDepois = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(vendaDepois.deletedAt).toBeTruthy();

    // Mercadoria de volta e caixas de volta, aos números de antes da venda.
    const depoisEstoque = await EstoqueService.getTotalValue(tenantId);
    expect(depoisEstoque.toString()).toBe(antesEstoque.toString());

    const saldoDepois = await CaixasService.getSaldo(tenantId);
    expect(saldoDepois.comClientes).toBe(saldoAntes.comClientes);
  });

  it("as caixas voltam LIMPAS — não entram na fila de higienização", async () => {
    const saldoAntes = await CaixasService.getSaldo(tenantId);
    const { conta } = await vendaFiada({ qtd: 12, preco: 2, caixas: 12 });

    // Durante a venda elas saem do estoque limpo.
    const saldoNaVenda = await CaixasService.getSaldo(tenantId);
    expect(saldoNaVenda.limpas).toBe(saldoAntes.limpas - 12);

    await FiadoService.remove(conta.id, ctx);

    // E voltam para `limpas`, não para `sujas`. Um movimento de RETORNO faria
    // o contrário (`sujas = entrada_suja + retorno − …`), mandando higienizar
    // caixa que nunca saiu do box — por isso a reversão apaga o movimento.
    const saldoDepois = await CaixasService.getSaldo(tenantId);
    expect(saldoDepois.limpas).toBe(saldoAntes.limpas);
    expect(saldoDepois.sujas).toBe(saldoAntes.sujas);
    expect(saldoDepois.emHigienizacao).toBe(saldoAntes.emHigienizacao);
  });

  it("não deixa movimento de caixa órfão da venda apagada", async () => {
    const { sale, conta } = await vendaFiada({ qtd: 7, preco: 2, caixas: 7 });
    await FiadoService.remove(conta.id, ctx);

    const movimentos = await prisma.plasticCrateMovement.count({
      where: { saleId: sale.id },
    });
    expect(movimentos).toBe(0);

    const baixas = await prisma.stockMovement.count({
      where: { sourceType: "SALE", sourceId: sale.id },
    });
    expect(baixas).toBe(0);
  });

  it("RECUSA excluir conta que já recebeu pagamento", async () => {
    const { conta } = await vendaFiada({ qtd: 50, preco: 2 });
    await FiadoService.registrarPagamento(
      { accountId: conta.id, amount: 30, method: "DINHEIRO" },
      ctx,
    );

    await expect(FiadoService.remove(conta.id, ctx)).rejects.toThrow(/pagamento/i);

    // Nada pode ter sido revertido pela tentativa recusada.
    const aindaLa = await prisma.creditAccount.findUniqueOrThrow({ where: { id: conta.id } });
    expect(aindaLa.deletedAt).toBeNull();
    expect(Number(aindaLa.paidAmount)).toBe(30);
  });

  it("recusa id inexistente", async () => {
    await expect(FiadoService.remove("nao-existe", ctx)).rejects.toThrow(/não encontrada/i);
  });

  it("registra a exclusão na auditoria", async () => {
    const { conta } = await vendaFiada({ qtd: 5, preco: 2 });
    await FiadoService.remove(conta.id, ctx);

    const log = await prisma.auditLog.findFirst({
      where: { tenantId, entity: "CreditAccount", entityId: conta.id, action: "DELETE" },
    });
    expect(log).toBeTruthy();
  });
});

describe("Edição de lançamento de fiado", () => {
  it("altera vencimento, telefone e observação sem tocar nos valores", async () => {
    const { conta } = await vendaFiada({ qtd: 8, preco: 2 });

    const atualizada = await FiadoService.update(
      {
        id: conta.id,
        customerPhone: "31999990000",
        dueDate: "2026-12-31",
        notes: "Combinado para o dia 31",
      },
      ctx,
    );

    expect(atualizada.customerPhone).toBe("31999990000");
    expect(atualizada.notes).toBe("Combinado para o dia 31");
    // Os valores são da venda, não editáveis por aqui.
    expect(Number(atualizada.totalAmount)).toBe(16);
    expect(Number(atualizada.paidAmount)).toBe(0);
  });
});
