import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { VendasService } from "@/lib/services/vendas.service";
import { CaixasService } from "@/lib/services/caixas.service";
import { ComprasService } from "@/lib/services/compras.service";
import { EstoqueService } from "@/lib/services/estoque.service";
import { FiadoService } from "@/lib/services/fiado.service";
import { isoDateTz } from "@/lib/tz";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";

/**
 * O PDV depois de ganhar desconto, pagamento misto, troco e cancelamento.
 *
 * Cada teste aqui existe por um comportamento que o comerciante depende: a parte
 * fiada de uma venda mista não pode cobrar o total, o cancelamento tem de
 * devolver mercadoria E caixas, e nada disso pode continuar contando como
 * faturamento.
 */

const tenants: string[] = [];
let tenantId = "";
let productId = "";
let ctx = makeCtx("");

const hoje = isoDateTz();

beforeAll(async () => {
  tenantId = await createTestTenant("PDV FLUXO");
  tenants.push(tenantId);
  ctx = makeCtx(tenantId);
  const p = await getTenantPrisma(tenantId).product.create({
    data: { tenantId, name: "Tomate", saleUnit: "KG" },
  });
  productId = p.id;
});

afterAll(async () => {
  await cleanupTenants(tenants);
});

/** Repõe estoque e caixas e limpa as vendas entre os testes. */
beforeEach(async () => {
  await prisma.salePayment.deleteMany({ where: { tenantId } });
  await prisma.creditPayment.deleteMany({ where: { tenantId } });
  await prisma.creditAccount.deleteMany({ where: { tenantId } });
  await prisma.saleItem.deleteMany({ where: { tenantId } });
  await prisma.sale.deleteMany({ where: { tenantId } });
  await prisma.stockMovement.deleteMany({ where: { tenantId } });
  await prisma.plasticCrateMovement.deleteMany({ where: { tenantId } });

  await ComprasService.registrarCompra(
    {
      supplierId: null,
      purchaseDate: hoje,
      freight: 0,
      items: [{ productId, quantity: 100, unitPrice: 2 }],
    },
    ctx,
  );
  await CaixasService.registrar(
    { type: "ENTRADA", quantity: 50, supplierName: "Ceasa", movementDate: hoje },
    ctx,
  );
});

const venda = (patch: Record<string, unknown> = {}) =>
  VendasService.registrarVenda(
    {
      paymentMethod: "DINHEIRO",
      items: [{ productId, quantity: 10, unitPrice: 5 }],
      ...patch,
    } as Parameters<typeof VendasService.registrarVenda>[0],
    ctx,
  );

describe("Quantidade decimal (venda por quilo)", () => {
  it("registra 2,350 kg sem arredondar", async () => {
    const s = await venda({ items: [{ productId, quantity: 2.35, unitPrice: 8 }] });
    expect(s.items[0]!.quantity.toString()).toBe("2.35");
    expect(s.totalAmount.toString()).toBe("18.8");
    const saldo = await EstoqueService.getQuantity(tenantId, productId);
    expect(saldo.toString()).toBe("97.65");
  });
});

describe("Desconto", () => {
  it("desconto por item reduz a linha e o total", async () => {
    const s = await venda({
      items: [{ productId, quantity: 10, unitPrice: 5, discountAmount: 8 }],
    });
    expect(s.subtotalAmount.toString()).toBe("50");
    expect(s.items[0]!.lineTotal.toString()).toBe("42");
    expect(s.totalAmount.toString()).toBe("42");
  });

  it("desconto na venda entra depois dos descontos de linha e guarda o motivo", async () => {
    const s = await venda({
      items: [{ productId, quantity: 10, unitPrice: 5, discountAmount: 5 }],
      discountAmount: 10,
      discountReason: "cliente antigo",
    });
    expect(s.subtotalAmount.toString()).toBe("50");
    expect(s.discountAmount.toString()).toBe("10");
    expect(s.discountReason).toBe("cliente antigo");
    expect(s.totalAmount.toString()).toBe("35"); // 50 − 5 − 10
  });

  it("recusa desconto maior que a venda", async () => {
    await expect(venda({ discountAmount: 9999 })).rejects.toThrow(/desconto/i);
  });
});

describe("Troco", () => {
  it("guarda o recebido e calcula o troco", async () => {
    const s = await venda({ amountReceived: 100 });
    expect(s.totalAmount.toString()).toBe("50");
    expect(s.amountReceived?.toString()).toBe("100");
    expect(s.changeGiven?.toString()).toBe("50");
  });

  it("sem dinheiro na venda, não grava troco", async () => {
    const s = await venda({ paymentMethod: "PIX", amountReceived: 100 });
    expect(s.amountReceived).toBeNull();
    expect(s.changeGiven).toBeNull();
  });
});

describe("Pagamento misto", () => {
  it("grava as parcelas e cobra no fiado só a parte fiada", async () => {
    const s = await venda({
      customerName: "João",
      customerPhone: "31999990000",
      paymentMethod: "PIX",
      payments: [
        { method: "PIX", amount: 30 },
        { method: "FIADO", amount: 20 },
      ],
    });

    expect(s.payments).toHaveLength(2);
    // Marcada como FIADO: existe conta a receber e ela precisa aparecer como tal.
    expect(s.paymentMethod).toBe("FIADO");

    const conta = await prisma.creditAccount.findFirstOrThrow({ where: { saleId: s.id } });
    expect(conta.totalAmount.toString()).toBe("20"); // não os 50 da venda
    expect(conta.customerPhone).toBe("31999990000");
  });

  it("venda de forma única também grava a sua parcela (fonte única do caixa)", async () => {
    const s = await venda({ paymentMethod: "PIX" });
    expect(s.payments).toHaveLength(1);
    expect(s.payments[0]!.method).toBe("PIX");
    expect(s.payments[0]!.amount.toString()).toBe("50");
  });

  it("sem parte fiada, não cria conta a receber", async () => {
    const s = await venda({
      payments: [
        { method: "PIX", amount: 25 },
        { method: "DINHEIRO", amount: 25 },
      ],
    });
    expect(await prisma.creditAccount.count({ where: { saleId: s.id } })).toBe(0);
    expect(s.paymentMethod).toBe("PIX"); // empate resolvido pela primeira maior
  });
});

describe("Cancelamento de venda", () => {
  it("devolve mercadoria e caixas, e desfaz o fiado", async () => {
    const antes = await EstoqueService.getQuantity(tenantId, productId);
    const s = await venda({
      customerName: "João",
      paymentMethod: "FIADO",
      plasticCrateQty: 6,
    });
    expect((await EstoqueService.getQuantity(tenantId, productId)).toString()).toBe(
      antes.minus(10).toString(),
    );
    expect((await CaixasService.getSaldo(tenantId)).comClientes).toBe(6);

    const r = await VendasService.cancelarVenda({ id: s.id, motivo: "erro de digitação" }, ctx);
    expect(r.itensDevolvidos).toBe(1);
    expect(r.caixasEstornadas).toBe(6);
    expect(r.fiadoRemovido).toBe(true);

    // Estoque de volta ao que era.
    expect((await EstoqueService.getQuantity(tenantId, productId)).toString()).toBe(
      antes.toString(),
    );
    // Caixas voltam LIMPAS: nunca saíram do box, não vão para a fila de lavagem.
    const saldo = await CaixasService.getSaldo(tenantId);
    expect(saldo.comClientes).toBe(0);
    expect(saldo.limpas).toBe(50);
    expect(saldo.sujas).toBe(0);

    // ...e saem do saldo DAQUELE cliente, não só do total. O `saldoPorCliente`
    // não descontava o ESTORNO_SAIDA, então a tela do fiado seguia pedindo a
    // devolução de 6 caixas que o estorno já havia trazido de volta — e o
    // formulário aceitava, tirando do estoque caixas que ninguém devia.
    expect((await CaixasService.saldoPorCliente(tenantId)).get("João")).toBeUndefined();

    // A conta de fiado sai da listagem.
    const { contas } = await FiadoService.listOpen(tenantId);
    expect(contas.filter((c) => c.saleId === s.id)).toHaveLength(0);

    const cancelada = await prisma.sale.findUniqueOrThrow({ where: { id: s.id } });
    expect(cancelada.cancelledAt).not.toBeNull();
    expect(cancelada.cancelledReason).toBe("erro de digitação");
  });

  it("a devolução entra como AJUSTE, para não sujar o custo médio", async () => {
    const s = await venda();
    await VendasService.cancelarVenda({ id: s.id }, ctx);
    const movs = await prisma.stockMovement.findMany({
      where: { tenantId, sourceId: s.id, sourceType: "SALE_CANCELLED" },
    });
    expect(movs).toHaveLength(1);
    // `ENTRADA` alimenta a média de custo; devolução por cancelamento não é compra.
    expect(movs[0]!.type).toBe("AJUSTE");
  });

  it("venda cancelada sai do faturamento", async () => {
    const s = await venda();
    const somaAntes = await prisma.sale.aggregate({
      _sum: { totalAmount: true },
      where: { tenantId, cancelledAt: null },
    });
    expect(Number(somaAntes._sum.totalAmount)).toBe(50);

    await VendasService.cancelarVenda({ id: s.id }, ctx);
    const somaDepois = await prisma.sale.aggregate({
      _sum: { totalAmount: true },
      where: { tenantId, cancelledAt: null },
    });
    expect(Number(somaDepois._sum.totalAmount ?? 0)).toBe(0);
  });

  it("não cancela duas vezes", async () => {
    const s = await venda();
    await VendasService.cancelarVenda({ id: s.id }, ctx);
    await expect(VendasService.cancelarVenda({ id: s.id }, ctx)).rejects.toThrow(/já foi cancelada/i);
  });

  it("fiado com recebimento não cancela — o dinheiro já entrou", async () => {
    const s = await venda({ customerName: "João", paymentMethod: "FIADO" });
    const conta = await prisma.creditAccount.findFirstOrThrow({ where: { saleId: s.id } });
    await FiadoService.registrarPagamento(
      { accountId: conta.id, amount: 10, method: "DINHEIRO" },
      ctx,
    );
    await expect(VendasService.cancelarVenda({ id: s.id }, ctx)).rejects.toThrow(/recebimento/i);
  });

  it("recusa fora da janela de 24h", async () => {
    const s = await venda();
    await prisma.sale.update({
      where: { id: s.id },
      data: { saleDate: new Date(Date.now() - 48 * 3600_000) },
    });
    await expect(VendasService.cancelarVenda({ id: s.id }, ctx)).rejects.toThrow(/24h/);
  });

  it("estorna só as caixas que ainda estão com o cliente", async () => {
    const s = await venda({ customerName: "João", plasticCrateQty: 6 });
    // O cliente já devolveu 4 antes de a venda ser cancelada.
    await CaixasService.registrar(
      { type: "RETORNO", quantity: 4, customerName: "João", movementDate: hoje },
      ctx,
    );

    const r = await VendasService.cancelarVenda({ id: s.id }, ctx);
    expect(r.caixasEstornadas).toBe(2);
    expect(r.caixasNaoEstornadas).toBe(4);
    const saldo = await CaixasService.getSaldo(tenantId);
    expect(saldo.comClientes).toBe(0);
    // As 4 devolvidas antes seguem sujas (voltaram do cliente); as 2 estornadas
    // voltam limpas. Somando, o estoque físico fecha em 50.
    expect(saldo.sujas).toBe(4);
    expect(saldo.limpas).toBe(46);
    expect(saldo.vazias).toBe(50);
  });
});

describe("Sugestões do PDV", () => {
  it("mais vendidos ignora vendas canceladas", async () => {
    const s = await venda();
    expect(await VendasService.maisVendidos(tenantId)).toContain(productId);
    await VendasService.cancelarVenda({ id: s.id }, ctx);
    expect(await VendasService.maisVendidos(tenantId)).not.toContain(productId);
  });

  it("preço sugerido cai para o da compra quando nunca houve venda", async () => {
    const precos = await VendasService.precosSugeridosDaCompra(tenantId);
    // Custo 2,00 e nenhum preço sugerido lançado → custo + margem padrão (30%).
    expect(precos[productId]).toBeCloseTo(2.6, 2);
  });

  it("repetir a última venda traz os itens do cliente", async () => {
    await venda({ customerName: "João", items: [{ productId, quantity: 3, unitPrice: 7 }] });
    const ultima = await VendasService.ultimaVenda(tenantId, "João");
    expect(ultima?.itens).toHaveLength(1);
    expect(ultima?.itens[0]!.quantity).toBe(3);
    expect(ultima?.customerName).toBe("João");
  });

  it("a última venda ignora canceladas", async () => {
    const s = await venda({ customerName: "Maria" });
    await VendasService.cancelarVenda({ id: s.id }, ctx);
    expect(await VendasService.ultimaVenda(tenantId, "Maria")).toBeNull();
  });
});

describe("Histórico de vendas", () => {
  it("filtra por forma de pagamento e busca por cliente", async () => {
    await venda({ customerName: "João da Feira", paymentMethod: "PIX" });
    await venda({ customerName: "Maria", paymentMethod: "DINHEIRO" });

    const porForma = await VendasService.list(tenantId, { preset: "todas", paymentMethod: "PIX" });
    expect(porForma.map((v) => v.customerName)).toEqual(["João da Feira"]);

    const porNome = await VendasService.list(tenantId, { preset: "todas", q: "joão" });
    expect(porNome).toHaveLength(1);
  });

  it("canceladas ficam fora por padrão e aparecem sob demanda", async () => {
    const s = await venda({ customerName: "João" });
    await VendasService.cancelarVenda({ id: s.id }, ctx);

    expect(await VendasService.count(tenantId, { preset: "todas" })).toBe(0);
    expect(
      await VendasService.count(tenantId, { preset: "todas", incluirCanceladas: true }),
    ).toBe(1);
  });

  it("os totais do recorte batem com o filtro", async () => {
    await venda({ paymentMethod: "PIX", discountAmount: 5 });
    await venda({ paymentMethod: "DINHEIRO" });

    const t = await VendasService.totaisDoFiltro(tenantId, { preset: "todas" });
    expect(t.quantidade).toBe(2);
    expect(Number(t.total)).toBe(95); // 45 + 50
    expect(Number(t.descontos)).toBe(5);
  });

  it("o detalhe traz itens, parcelas e o que a venda movimentou", async () => {
    const s = await venda({
      customerName: "João",
      plasticCrateQty: 2,
      payments: [
        { method: "PIX", amount: 25 },
        { method: "DINHEIRO", amount: 25 },
      ],
    });
    const detalhe = await VendasService.get(tenantId, s.id);
    expect(detalhe.items).toHaveLength(1);
    expect(detalhe.payments).toHaveLength(2);
    expect(detalhe.movimentosEstoque).toHaveLength(1);
    expect(detalhe.crateMovements).toHaveLength(1);
    expect(detalhe.podeCancelar).toBe(true);
  });
});

describe("Módulo de caixas desabilitado", () => {
  it("ignora as caixas em vez de barrar a venda", async () => {
    const semCaixas = makeCtx(tenantId);
    semCaixas.session.modules = ["higienizacao"];

    const s = await VendasService.registrarVenda(
      {
        customerName: "João",
        paymentMethod: "DINHEIRO",
        // Mais caixas do que existem: com o módulo ligado isto seria recusado.
        plasticCrateQty: 999,
        items: [{ productId, quantity: 1, unitPrice: 5 }],
      },
      semCaixas,
    );

    expect(s.plasticCrateQty).toBe(0);
    expect(await prisma.plasticCrateMovement.count({ where: { tenantId, saleId: s.id } })).toBe(0);
  });
});

describe("Troco em pagamento misto (regressao)", () => {
  // Venda de R$ 50: R$ 30 em PIX + R$ 20 em dinheiro. O cliente entrega uma
  // nota de R$ 50 pela parte em especie e tem R$ 30 de troco.
  //
  // O codigo antigo comparava o recebido com o TOTAL: 50 nao e maior que 50,
  // entao gravava troco R$ 0,00 — e ainda registrava amountReceived = 50 numa
  // venda em que so entraram R$ 20 em especie. A gaveta nunca fechava.
  it("calcula o troco contra a parte em especie, nao contra o total", async () => {
    const s = await venda({
      paymentMethod: "PIX",
      payments: [
        { method: "PIX", amount: 30 },
        { method: "DINHEIRO", amount: 20 },
      ],
      amountReceived: 50,
    });
    expect(s.totalAmount.toString()).toBe("50");
    expect(s.amountReceived?.toString()).toBe("50");
    expect(s.changeGiven?.toString()).toBe("30");
  });

  it("sem sobra na parte em especie, o troco e zero", async () => {
    const s = await venda({
      paymentMethod: "PIX",
      payments: [
        { method: "PIX", amount: 30 },
        { method: "DINHEIRO", amount: 20 },
      ],
      amountReceived: 20,
    });
    expect(s.changeGiven?.toString()).toBe("0");
  });

  it("forma unica em dinheiro continua como sempre foi", async () => {
    const s = await venda({ amountReceived: 100 });
    expect(s.totalAmount.toString()).toBe("50");
    expect(s.changeGiven?.toString()).toBe("50");
  });
});

describe("Ledger de parcelas fecha com o total da venda (regressao)", () => {
  // A validacao tolera um centavo porque o operador digita as parcelas a mao.
  // Gravar a folga deixava `sale_payments` sem fechar com `sales.totalAmount`:
  // o fluxo de caixa soma as parcelas e o relatorio de vendas soma o total, e
  // as duas visoes da mesma venda divergiam sem nada acusar.
  it("absorve o residuo de centavo numa parcela nao fiada", async () => {
    const s = await venda({
      paymentMethod: "PIX",
      items: [{ productId, quantity: 1, unitPrice: 10 }],
      payments: [
        { method: "PIX", amount: 3.33 },
        { method: "DINHEIRO", amount: 3.33 },
        { method: "CARTAO", amount: 3.33 },
      ],
    });
    expect(s.totalAmount.toString()).toBe("10");

    const soma = s.payments.reduce((a, p) => a + Number(p.amount), 0);
    expect(soma.toFixed(2)).toBe(Number(s.totalAmount).toFixed(2));
  });

  it("nao mexe na parcela fiada ao acertar o residuo", async () => {
    const s = await venda({
      customerName: "Joao",
      paymentMethod: "FIADO",
      items: [{ productId, quantity: 1, unitPrice: 10 }],
      payments: [
        { method: "PIX", amount: 3.33 },
        { method: "DINHEIRO", amount: 3.33 },
        { method: "FIADO", amount: 3.33 },
      ],
    });
    const fiada = s.payments.find((p) => p.method === "FIADO");
    expect(fiada?.amount.toString()).toBe("3.33");

    // A conta a receber cobra exatamente a parcela fiada.
    const conta = await prisma.creditAccount.findFirstOrThrow({ where: { saleId: s.id } });
    expect(conta.totalAmount.toString()).toBe("3.33");

    const soma = s.payments.reduce((a, p) => a + Number(p.amount), 0);
    expect(soma.toFixed(2)).toBe(Number(s.totalAmount).toFixed(2));
  });
});

describe("Caixas plasticas declaradas no item (regressao)", () => {
  // O PDV manda plasticCrateQty: 0 sempre que o checkbox esta desmarcado. O
  // zero vencia a soma por item, e as caixas saiam do box sem movimento nenhum
  // — apesar de aparecerem na tela de detalhe da venda.
  it("zero no cabecalho nao apaga as caixas do item", async () => {
    const s = await venda({
      customerName: "Joao",
      plasticCrateQty: 0,
      items: [
        { productId, quantity: 10, unitPrice: 5, recipientType: "PLASTICA", crateQty: 4 },
      ],
    });
    expect(s.plasticCrateQty).toBe(4);

    const movimentos = await prisma.plasticCrateMovement.findMany({
      where: { tenantId, saleId: s.id },
    });
    expect(movimentos).toHaveLength(1);
    expect(movimentos[0]!.quantity).toBe(4);
    expect(movimentos[0]!.customerName).toBe("Joao");

    const saldo = await CaixasService.getSaldo(tenantId);
    expect(saldo.comClientes).toBe(4);
  });
});

describe("Cancelamento concorrente (regressao)", () => {
  // O teste que ja existia ("nao cancela duas vezes") e SEQUENCIAL: a segunda
  // chamada so acontece depois da primeira terminar, entao a checagem feita
  // fora da transacao ja enxerga cancelledAt preenchido e recusa. Ele nao
  // detecta corrida nenhuma.
  //
  // Com duas chamadas de verdade simultaneas, as duas passavam pela checagem
  // (que roda ANTES da transacao) e as duas gravavam AJUSTE: a mercadoria
  // voltava ao estoque DUAS vezes e o estorno de caixas rodava duas vezes.
  it("duas chamadas simultaneas creditam o estoque uma vez so", async () => {
    const s = await venda();
    const antes = Number(await EstoqueService.getQuantity(tenantId, productId));

    const resultados = await Promise.allSettled([
      VendasService.cancelarVenda({ id: s.id }, ctx),
      VendasService.cancelarVenda({ id: s.id }, ctx),
    ]);

    const aceitos = resultados.filter((r) => r.status === "fulfilled");
    expect(aceitos).toHaveLength(1);

    const estornos = await prisma.stockMovement.count({
      where: { tenantId, sourceId: s.id, sourceType: "SALE_CANCELLED" },
    });
    expect(estornos).toBe(s.items.length);

    const depois = Number(await EstoqueService.getQuantity(tenantId, productId));
    expect(depois).toBe(antes + 10);
  });

  it("duas chamadas simultaneas estornam as caixas uma vez so", async () => {
    const s = await venda({ customerName: "Joao", plasticCrateQty: 6 });
    const saldoAntes = await CaixasService.getSaldo(tenantId);
    expect(saldoAntes.comClientes).toBe(6);

    const resultados = await Promise.allSettled([
      VendasService.cancelarVenda({ id: s.id }, ctx),
      VendasService.cancelarVenda({ id: s.id }, ctx),
    ]);
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    const saldoDepois = await CaixasService.getSaldo(tenantId);
    expect(saldoDepois.comClientes).toBe(0);
    expect(saldoDepois.limpas).toBe(saldoAntes.limpas + 6);
  });
});

describe("Corrida de estoque (regressao)", () => {
  // Em READ COMMITTED (o padrao do Postgres) a validacao de saldo lia o mesmo
  // groupBy em todas as transacoes concorrentes: as N passavam e o estoque
  // terminava NEGATIVO. O lock nas linhas de `products` serializa as vendas do
  // mesmo produto, entao o resultado passa a ser deterministico.
  it("cinco vendas simultaneas de um saldo de 6 nao levam o estoque a negativo", async () => {
    // beforeEach compra 100. Consome 94 para sobrar exatamente 6.
    await venda({ items: [{ productId, quantity: 94, unitPrice: 1 }] });
    expect(Number(await EstoqueService.getQuantity(tenantId, productId))).toBe(6);

    const resultados = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        venda({ items: [{ productId, quantity: 2, unitPrice: 1 }] }),
      ),
    );

    const aceitas = resultados.filter((r) => r.status === "fulfilled");
    const recusadas = resultados.filter((r) => r.status === "rejected");
    expect(aceitas).toHaveLength(3);
    expect(recusadas).toHaveLength(2);
    for (const r of recusadas) {
      expect(String((r as PromiseRejectedResult).reason)).toMatch(/estoque/i);
    }

    const saldo = Number(await EstoqueService.getQuantity(tenantId, productId));
    expect(saldo).toBe(0);
    expect(saldo).toBeGreaterThanOrEqual(0);
  });
});

describe("Checagem de estoque arredonda como o PDV (regressao)", () => {
  // O PDV monta 0.1 + 0.2 como 0.30000000000000004 e aprova, porque
  // `passaDoEstoque` arredonda para 3 casas — a precisao da coluna. O servidor
  // comparava com `gt` cru e RECUSAVA uma venda que cabia.
  it("aceita a quantidade que o browser monta com ruido de ponto flutuante", async () => {
    await venda({ items: [{ productId, quantity: 99.7, unitPrice: 1 }] });
    expect(Number(await EstoqueService.getQuantity(tenantId, productId))).toBe(0.3);

    const s = await venda({ items: [{ productId, quantity: 0.1 + 0.2, unitPrice: 1 }] });
    expect(s.id).toBeTruthy();
    expect(Number(await EstoqueService.getQuantity(tenantId, productId))).toBe(0);
  });
});

describe("Idempotencia da venda (regressao)", () => {
  const chave = () => globalThis.crypto.randomUUID();

  // Rede do CEASA oscilando: o POST chega, a transacao commita e a resposta se
  // perde. O operador via "Falha de conexao. Tente novamente." — uma mensagem
  // que MANDA repetir — e o segundo toque registrava tudo de novo: estoque
  // baixado em dobro, segunda conta de fiado no mesmo nome, duas saidas de
  // caixa. O servidor nao tinha como distinguir retentativa de venda nova.
  it("retentativa com a mesma chave devolve a venda original, sem duplicar nada", async () => {
    const k = chave();
    const primeira = await venda({ idempotencyKey: k, customerName: "Joao", paymentMethod: "FIADO" });
    const segunda = await venda({ idempotencyKey: k, customerName: "Joao", paymentMethod: "FIADO" });

    expect(segunda.id).toBe(primeira.id);
    expect(primeira.jaRegistrada).toBe(false);
    expect(segunda.jaRegistrada).toBe(true);

    expect(await prisma.sale.count({ where: { tenantId, idempotencyKey: k } })).toBe(1);
    expect(
      await prisma.stockMovement.count({ where: { tenantId, sourceId: primeira.id } }),
    ).toBe(1);
    expect(await prisma.creditAccount.count({ where: { tenantId, saleId: primeira.id } })).toBe(1);
    // E o estoque baixou UMA vez: 100 comprados menos os 10 da venda.
    expect(Number(await EstoqueService.getQuantity(tenantId, productId))).toBe(90);
  });

  // O caminho rapido (buscar antes de abrir a transacao) nao cobre o duplo
  // clique: as duas chamadas comecam juntas e nenhuma enxerga a outra. Quem
  // fecha essa porta e o indice unico, e este teste exercita esse ramo.
  it("duplo clique simultaneo grava uma venda so", async () => {
    const k = chave();
    const resultados = await Promise.allSettled([
      venda({ idempotencyKey: k }),
      venda({ idempotencyKey: k }),
    ]);

    const aceitas = resultados.filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof venda>>> =>
        r.status === "fulfilled",
    );
    expect(aceitas).toHaveLength(2);
    expect(aceitas[0]!.value.id).toBe(aceitas[1]!.value.id);
    expect(await prisma.sale.count({ where: { tenantId, idempotencyKey: k } })).toBe(1);
    expect(Number(await EstoqueService.getQuantity(tenantId, productId))).toBe(90);
  });

  it("chaves diferentes continuam sendo vendas diferentes", async () => {
    // Duas vendas identicas em sequencia sao corriqueiras no balcao — mesmo
    // cliente, mesmos 10 kg. Deduplicar por conteudo recusaria dinheiro real.
    const a = await venda({ idempotencyKey: chave() });
    const b = await venda({ idempotencyKey: chave() });
    expect(a.id).not.toBe(b.id);
    expect(Number(await EstoqueService.getQuantity(tenantId, productId))).toBe(80);
  });

  it("sem chave, o comportamento antigo continua valendo", async () => {
    const a = await venda();
    const b = await venda();
    expect(a.id).not.toBe(b.id);
    expect(a.idempotencyKey).toBeNull();
  });
});

describe("Data digitada no formulario nao volta um dia (regressao)", () => {
  // `new Date("2026-09-04")` e meia-noite UTC — 03/09 as 21h em Sao Paulo. A
  // venda caia no dia ANTERIOR no painel, no historico com preset "hoje", no
  // fluxo de caixa e no relatorio. Estes eram os dois unicos
  // `new Date(<entrada do usuario>)` do projeto; todos os outros servicos ja
  // usavam `parseFormDateTz`. A prova de que era inconsistencia, e nao regra:
  // editar o fiado pelo formulario "consertava" a data, porque `FiadoService`
  // ja convertia com fuso.
  const DIA = "2026-09-04";

  it("a venda fica no dia escolhido", async () => {
    const s = await venda({ saleDate: DIA });
    expect(isoDateTz(s.saleDate)).toBe(DIA);
  });

  it("o vencimento do fiado fica no dia escolhido", async () => {
    const s = await venda({
      customerName: "Joao",
      paymentMethod: "FIADO",
      dueDate: DIA,
    });
    const conta = await prisma.creditAccount.findFirstOrThrow({ where: { saleId: s.id } });
    expect(conta.dueDate).not.toBeNull();
    expect(isoDateTz(conta.dueDate!)).toBe(DIA);
  });
});

describe("Corrida no saldo de caixas plasticas (regressao)", () => {
  // Sete lugares liam `getSaldo` ANTES de abrir a transacao e passavam o
  // retrato adiante — os proprios comentarios admitiam ("Saldo lido FORA da
  // transacao"). TOCTOU classico: com 50 caixas limpas, duas vendas
  // simultaneas de 30 liam as duas o mesmo 50, as duas passavam em
  // `assertCrateMovement` e o pote terminava NEGATIVO. E `computeCrateSaldo`
  // nao tem piso, entao a tela passava a exibir estoque negativo.
  it("duas vendas simultaneas de 30 caixas sobre 50 limpas: so uma passa", async () => {
    const antes = await CaixasService.getSaldo(tenantId);
    expect(antes.limpas).toBe(50);

    const resultados = await Promise.allSettled([
      venda({ customerName: "Joao", plasticCrateQty: 30 }),
      venda({ customerName: "Maria", plasticCrateQty: 30 }),
    ]);

    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(resultados.filter((r) => r.status === "rejected")).toHaveLength(1);

    const depois = await CaixasService.getSaldo(tenantId);
    expect(depois.limpas).toBe(20);
    expect(depois.comClientes).toBe(30);
    expect(depois.limpas).toBeGreaterThanOrEqual(0);
  });
});
