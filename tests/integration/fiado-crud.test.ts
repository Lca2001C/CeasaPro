import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { FiadoService, FIADO_POR_PAGINA } from "@/lib/services/fiado.service";
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

  it("RECUSA excluir o fiado de venda mista — o PIX recebido sumiria do caixa", async () => {
    const sale = await VendasService.registrarVenda(
      {
        customerName: `Cliente ${uniq()}`,
        paymentMethod: "FIADO",
        payments: [
          { method: "PIX", amount: 40 },
          { method: "FIADO", amount: 60 },
        ],
        saleDate: new Date().toISOString(),
        items: [{ productId: produtoId, quantity: 50, unitPrice: 2 }],
      },
      ctx,
    );
    const conta = await prisma.creditAccount.findFirstOrThrow({ where: { saleId: sale.id } });

    await expect(FiadoService.remove(conta.id, ctx)).rejects.toThrow(/balcão/i);
    const venda = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(venda.deletedAt).toBeNull();
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

/**
 * Pagamentos simultâneos na mesma conta.
 *
 * O serviço lia o `paidAmount`, somava e gravava o total. Em READ COMMITTED
 * (padrão do Postgres) duas transações leem o mesmo saldo e a segunda grava o
 * dela por cima: sobravam dois `CreditPayment` no extrato e um só valor somado
 * na conta — dinheiro recebido continuando a aparecer como dívida do cliente.
 *
 * O que este teste fixa é a invariante, não o interleaving: o `paidAmount` da
 * conta tem de ser igual à soma dos pagamentos gravados, em qualquer ordem.
 */
describe("pagamentos simultâneos", () => {
  it("o saldo da conta fecha com a soma dos pagamentos do extrato", async () => {
    const { conta } = await vendaFiada({ qtd: 10, preco: 10 }); // total 100

    const tentativas = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        FiadoService.registrarPagamento(
          { accountId: conta.id, amount: 10, method: "DINHEIRO" },
          ctx,
        ),
      ),
    );

    const aceitos = tentativas.filter((t) => t.status === "fulfilled").length;
    expect(aceitos).toBeGreaterThan(0);

    const pagamentos = await prisma.creditPayment.findMany({
      where: { accountId: conta.id },
    });
    const somaExtrato = pagamentos.reduce((t, p) => t + Number(p.amount), 0);
    const depois = await prisma.creditAccount.findUniqueOrThrow({ where: { id: conta.id } });

    expect(Number(depois.paidAmount)).toBe(somaExtrato);
    // E nada de recibo gravado sem entrar no saldo.
    expect(pagamentos.length).toBe(aceitos);
  });

  it("pagamentos em sequência continuam somando (a guarda não atrapalha o normal)", async () => {
    // O caminho de todo dia é este: o cliente paga em parcelas, uma depois da
    // outra. A condição do UPDATE não pode recusar o segundo lançamento.
    const { conta } = await vendaFiada({ qtd: 10, preco: 10 });
    await FiadoService.registrarPagamento(
      { accountId: conta.id, amount: 40, method: "PIX" },
      ctx,
    );
    await FiadoService.registrarPagamento(
      { accountId: conta.id, amount: 20, method: "PIX" },
      ctx,
    );

    const depois = await prisma.creditAccount.findUniqueOrThrow({ where: { id: conta.id } });
    expect(Number(depois.paidAmount)).toBe(60);
    expect(depois.status).toBe("EM_ABERTO");
    expect(await prisma.creditPayment.count({ where: { accountId: conta.id } })).toBe(2);
  });
});

describe("caixas na listagem do fiado", () => {
  it("cliente com duas contas não conta as caixas duas vezes", async () => {
    // O saldo de caixas é por cliente; a conta é por venda. Quem compra a prazo
    // duas vezes tem duas contas, e o painel somava o saldo dele em cada uma.
    const cliente = `Freguês ${uniq()}`;
    // O painel soma o tenant inteiro, e outras contas deste arquivo já pesam:
    // o que este teste mede é a contribuição DESTE cliente.
    const { totalCaixas: antes } = await FiadoService.listOpen(tenantId, "EM_ABERTO");
    await CaixasService.registrar(
      { type: "ENTRADA", quantity: 50, movementDate: new Date().toISOString() },
      ctx,
    );

    for (let i = 0; i < 2; i++) {
      await VendasService.registrarVenda(
        {
          customerName: cliente,
          paymentMethod: "FIADO",
          saleDate: new Date().toISOString(),
          plasticCrateQty: 6,
          items: [
            {
              productId: produtoId,
              quantity: 1,
              unitPrice: 10,
              recipientType: "PLASTICA" as const,
              crateQty: 6,
            },
          ],
        },
        ctx,
      );
    }

    const { contas, totalCaixas } = await FiadoService.listOpen(tenantId, "EM_ABERTO");
    const doCliente = contas.filter((c) => c.customerName === cliente);
    expect(doCliente.length).toBe(2);

    // 12 caixas saíram (6 + 6). O painel tem de crescer 12, não 24 — que é o
    // que dava ao somar o saldo do cliente uma vez por conta em aberto.
    const saldos = await CaixasService.saldoPorCliente(tenantId);
    expect(saldos.get(cliente)).toBe(12);
    expect(totalCaixas - antes).toBe(12);
  });
});

describe("Lançamento manual de fiado (regressão)", () => {
  const baixasDoProduto = () =>
    prisma.stockMovement.count({ where: { tenantId, productId: produtoId, type: "SAIDA" } });

  it("preço zero é recusado ANTES de gravar: sem venda, sem baixa, sem retentativa que duplica", async () => {
    const cliente = `Esquecido ${uniq()}`;
    const antes = await baixasDoProduto();
    const tentar = () =>
      FiadoService.create(
        {
          customerName: cliente,
          saleDate: "2026-09-10",
          items: [{ productId: produtoId, quantity: 3, unitPrice: 0 }],
        },
        ctx,
      );

    // O operador tenta duas vezes, como fazia ao ver o erro.
    await expect(tentar()).rejects.toThrow(/R\$ 0,00/);
    await expect(tentar()).rejects.toThrow(/R\$ 0,00/);

    expect(await prisma.sale.count({ where: { tenantId, customerName: cliente } })).toBe(0);
    expect(await baixasDoProduto()).toBe(antes);
  });

  it("telefone e observação entram na mesma transação da venda, na venda e na conta", async () => {
    const cliente = `Com telefone ${uniq()}`;
    const conta = await FiadoService.create(
      {
        customerName: cliente,
        customerPhone: "31988887777",
        notes: "Paga na sexta",
        saleDate: "2026-09-10",
        items: [{ productId: produtoId, quantity: 2, unitPrice: 5 }],
      },
      ctx,
    );

    expect(conta.customerPhone).toBe("31988887777");
    expect(conta.notes).toBe("Paga na sexta");
    const venda = await prisma.sale.findUniqueOrThrow({ where: { id: conta.saleId! } });
    // A venda ficava sem telefone: o detalhe em /vendas/[id] não o mostrava.
    expect(venda.customerPhone).toBe("31988887777");

    // A observação aparece na auditoria da venda, que roda dentro da transação.
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId, entity: "Sale", entityId: venda.id, action: "CREATE" },
    });
    expect(JSON.stringify(log.newData)).toContain("Paga na sexta");
  });
});

describe("Cartões da lista do fiado na aba 'Pagas' (regressão)", () => {
  it("o total a receber e as caixas na rua não zeram por causa do filtro", async () => {
    const aberto = await FiadoService.listOpen(tenantId, "EM_ABERTO");
    expect(Number(aberto.totalGeral)).toBeGreaterThan(0);

    // Uma conta quitada, para a aba "Pagas" ter o que listar.
    const { conta } = await vendaFiada({ qtd: 1, preco: 3 });
    await FiadoService.registrarPagamento({ accountId: conta.id, amount: 3, method: "PIX" }, ctx);

    const [emAberto, pagas, todas] = await Promise.all([
      FiadoService.listOpen(tenantId, "EM_ABERTO"),
      FiadoService.listOpen(tenantId, "PAGO"),
      FiadoService.listOpen(tenantId, "TODAS"),
    ]);
    expect(pagas.contas.every((c) => c.status === "PAGO")).toBe(true);
    expect(pagas.totalGeral.toString()).toBe(emAberto.totalGeral.toString());
    expect(pagas.totalCaixas).toBe(emAberto.totalCaixas);
    expect(todas.totalGeral.toString()).toBe(emAberto.totalGeral.toString());
  });
});

describe("Detalhe do fiado de venda mista (regressão)", () => {
  it("traz o total da venda e o que foi pago no balcão, além da parte fiada", async () => {
    const sale = await VendasService.registrarVenda(
      {
        customerName: `Misto ${uniq()}`,
        paymentMethod: "FIADO",
        payments: [
          { method: "PIX", amount: 60 },
          { method: "FIADO", amount: 40 },
        ],
        saleDate: new Date().toISOString(),
        items: [{ productId: produtoId, quantity: 10, unitPrice: 10 }],
      },
      ctx,
    );
    const conta = await prisma.creditAccount.findFirstOrThrow({ where: { saleId: sale.id } });
    const detalhe = await FiadoService.get(tenantId, conta.id);

    expect(detalhe.totalAmount.toString()).toBe("40");
    expect(detalhe.totalDaVenda.toString()).toBe("100");
    expect(detalhe.pagoNoBalcao.toString()).toBe("60");
  });

  it("fiado puro não tem nada pago no balcão", async () => {
    const { conta } = await vendaFiada({ qtd: 2, preco: 4 });
    const detalhe = await FiadoService.get(tenantId, conta.id);
    expect(detalhe.totalDaVenda.toString()).toBe("8");
    expect(detalhe.pagoNoBalcao.toString()).toBe("0");
  });
});

/**
 * Excluir fiado cujas caixas JÁ VOLTARAM.
 *
 * O RETORNO é lançado por nome de cliente, sem vínculo com a venda. Apagar a
 * SAIDA da venda nesse caso deixava o RETORNO sem contrapartida: o saldo do
 * cliente ia a negativo, `comClientes` também, e as caixas devolvidas
 * voltavam duas vezes (uma suja pelo retorno, outra limpa pela exclusão).
 */
describe("Exclusão de fiado com caixas já devolvidas (regressão)", () => {
  it("todas devolvidas: nada é estornado e o saldo do cliente fica em zero", async () => {
    const antes = await CaixasService.getSaldo(tenantId);
    const { conta } = await vendaFiada({ qtd: 10, preco: 2, caixas: 10 });
    await FiadoService.registrarDevolucaoCaixas(
      { accountId: conta.id, quantity: 10, movementDate: new Date().toISOString() },
      ctx,
    );

    const r = await FiadoService.remove(conta.id, ctx);
    expect(r.caixasEstornadas).toBe(0);
    expect(r.caixasNaoEstornadas).toBe(10);

    const saldos = await CaixasService.saldoPorCliente(tenantId);
    expect(saldos.get(conta.customerName) ?? 0).toBe(0);
    const depois = await CaixasService.getSaldo(tenantId);
    // Antes: `comClientes` terminava 10 ABAIXO do que era antes da venda.
    expect(depois.comClientes).toBe(antes.comClientes);
    // As 10 voltaram sujas pelo RETORNO — e só por ele.
    expect(depois.sujas).toBe(antes.sujas + 10);
    expect(depois.limpas).toBe(antes.limpas - 10);
  });

  it("parte devolvida: estorna só o que ainda está com o cliente", async () => {
    const antes = await CaixasService.getSaldo(tenantId);
    const { sale, conta } = await vendaFiada({ qtd: 10, preco: 2, caixas: 10 });
    await FiadoService.registrarDevolucaoCaixas(
      { accountId: conta.id, quantity: 4, movementDate: new Date().toISOString() },
      ctx,
    );

    const r = await FiadoService.remove(conta.id, ctx);
    expect(r.caixasEstornadas).toBe(6);
    expect(r.caixasNaoEstornadas).toBe(4);

    const saldos = await CaixasService.saldoPorCliente(tenantId);
    expect(saldos.get(conta.customerName) ?? 0).toBe(0);
    const depois = await CaixasService.getSaldo(tenantId);
    expect(depois.comClientes).toBe(antes.comClientes);
    // 6 voltam limpas pelo estorno, 4 já tinham voltado sujas.
    expect(depois.limpas).toBe(antes.limpas - 4);
    expect(depois.sujas).toBe(antes.sujas + 4);

    // A SAIDA fica (o RETORNO depende dela) e o estorno aponta para a venda.
    const movs = await prisma.plasticCrateMovement.findMany({
      where: { saleId: sale.id },
      select: { type: true, quantity: true },
    });
    expect(movs).toEqual(
      expect.arrayContaining([
        { type: "SAIDA", quantity: 10 },
        { type: "ESTORNO_SAIDA", quantity: 6 },
      ]),
    );

    const log = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId, entity: "CreditAccount", entityId: conta.id, action: "DELETE" },
    });
    expect(log.newData).toMatchObject({ caixasDevolvidas: 6, caixasNaoEstornadas: 4 });
  });

  it("cliente com outra venda: o saldo dele cobre a venda, e a exclusão é exata", async () => {
    // Retorno não é da venda, é do cliente: levou 8 + 5, devolveu 5. Excluir a
    // venda de 8 deixa o cliente com zero, sem estorno parcial.
    const cliente = `Duas vendas ${uniq()}`;
    const vender = (caixas: number) =>
      VendasService.registrarVenda(
        {
          customerName: cliente,
          paymentMethod: "FIADO",
          saleDate: new Date().toISOString(),
          plasticCrateQty: caixas,
          items: [
            {
              productId: produtoId,
              quantity: 1,
              unitPrice: 10,
              recipientType: "PLASTICA" as const,
              crateQty: caixas,
            },
          ],
        },
        ctx,
      );
    const venda8 = await vender(8);
    await vender(5);
    await CaixasService.registrar(
      {
        type: "RETORNO",
        quantity: 5,
        customerName: cliente,
        movementDate: new Date().toISOString(),
      },
      ctx,
    );
    const conta = await prisma.creditAccount.findFirstOrThrow({ where: { saleId: venda8.id } });

    const r = await FiadoService.remove(conta.id, ctx);
    expect(r.caixasEstornadas).toBe(8);
    expect(r.caixasNaoEstornadas).toBe(0);
    const saldos = await CaixasService.saldoPorCliente(tenantId);
    expect(saldos.get(cliente) ?? 0).toBe(0);
    expect(await prisma.plasticCrateMovement.count({ where: { saleId: venda8.id } })).toBe(0);
  });
});

/**
 * Abas "Pagas" e "Todas": paginadas, da mais recente para a mais antiga.
 *
 * Eram carregadas inteiras e em ordem crescente — a lista abria na conta mais
 * antiga e crescia sem teto. Os cartões continuam somando TODA a dívida em
 * aberto, não a página.
 */
describe("Paginação do fiado (regressão)", () => {
  let t = "";
  const base = Date.UTC(2026, 0, 1, 12);

  beforeAll(async () => {
    t = await createTestTenant("FIADO PAGINAS");
    tenants.push(t);
    // 3 abertas, as mais ANTIGAS — ficam na última página de "Todas".
    await prisma.creditAccount.createMany({
      data: [0, 1, 2].map((i) => ({
        tenantId: t,
        customerName: `Aberta ${i}`,
        totalAmount: 10,
        paidAmount: 0,
        status: "EM_ABERTO" as const,
        dueDate: new Date(base - 864e5),
        createdAt: new Date(base + i * 1000),
      })),
    });
    // 55 quitadas, mais novas.
    await prisma.creditAccount.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({
        tenantId: t,
        customerName: `Paga ${String(i).padStart(2, "0")}`,
        totalAmount: 5,
        paidAmount: 5,
        status: "PAGO" as const,
        createdAt: new Date(base + 60_000 + i * 1000),
      })),
    });
  });

  it("a aba de quitadas vem em páginas, da mais recente para a mais antiga", async () => {
    const p1 = await FiadoService.listOpen(t, "PAGO", undefined, { pagina: 1 });
    expect(p1.contas.length).toBe(FIADO_POR_PAGINA);
    expect(p1.total).toBe(55);
    expect(p1.ultimaPagina).toBe(2);
    expect(p1.contas[0]!.customerName).toBe("Paga 54");
    const datas = p1.contas.map((c) => c.createdAt.getTime());
    expect([...datas].sort((a, b) => b - a)).toEqual(datas);

    const p2 = await FiadoService.listOpen(t, "PAGO", undefined, { pagina: 2 });
    expect(p2.contas.length).toBe(5);
    expect(p2.contas.at(-1)!.customerName).toBe("Paga 00");
    // Nenhuma conta repetida entre as páginas.
    const ids = new Set([...p1.contas, ...p2.contas].map((c) => c.id));
    expect(ids.size).toBe(55);
  });

  it("os cartões somam TODA a dívida em aberto, mesmo fora da página", async () => {
    const todas1 = await FiadoService.listOpen(t, "TODAS", undefined, { pagina: 1 });
    // As abertas são as mais antigas: não estão na página 1.
    expect(todas1.contas.some((c) => c.status === "EM_ABERTO")).toBe(false);
    expect(todas1.total).toBe(58);
    expect(todas1.totalGeral.toString()).toBe("30");
    expect(todas1.vencidas).toBe(3);

    const pagas = await FiadoService.listOpen(t, "PAGO", undefined, { pagina: 2 });
    expect(pagas.totalGeral.toString()).toBe("30");
    expect(pagas.vencidas).toBe(3);
  });

  it("a aba em aberto continua inteira e em ordem crescente", async () => {
    const abertas = await FiadoService.listOpen(t, "EM_ABERTO", undefined, { pagina: 2 });
    expect(abertas.contas.map((c) => c.customerName)).toEqual([
      "Aberta 0",
      "Aberta 1",
      "Aberta 2",
    ]);
    expect(abertas.pagina).toBe(1);
    expect(abertas.ultimaPagina).toBe(1);
    expect(abertas.totalGeral.toString()).toBe("30");
  });

  it("a busca vale para a contagem e para os cartões", async () => {
    const r = await FiadoService.listOpen(t, "TODAS", "Aberta 1");
    expect(r.total).toBe(1);
    expect(r.contas.map((c) => c.customerName)).toEqual(["Aberta 1"]);
    expect(r.totalGeral.toString()).toBe("10");
  });
});
