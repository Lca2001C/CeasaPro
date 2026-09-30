import { describe, it, expect } from "vitest";
import {
  brutoDoItem,
  totalDaVenda,
  vendaSchema,
  type VendaInput,
} from "@/lib/validations/venda";
import {
  devolucaoCaixasSchema,
  fiadoManualSchema,
  fiadoUpdateSchema,
} from "@/lib/validations/fiado";
import { formaPredominante, resolvePlasticCrateQty } from "@/lib/services/vendas.service";

const item = (patch: Partial<VendaInput["items"][number]> = {}) => ({
  productId: "p1",
  quantity: 2,
  unitPrice: 10,
  ...patch,
});

const venda = (patch: Partial<VendaInput> = {}): unknown => ({
  paymentMethod: "DINHEIRO",
  items: [item()],
  ...patch,
});

describe("total da venda com desconto", () => {
  it("sem desconto, é a soma das linhas", () => {
    expect(totalDaVenda({ items: [item(), item({ quantity: 1 })] })).toBe(30);
  });

  it("desconto por item sai da linha", () => {
    expect(totalDaVenda({ items: [item({ discountAmount: 5 })] })).toBe(15);
  });

  it("desconto da venda sai do total, depois dos descontos de linha", () => {
    expect(
      totalDaVenda({ items: [item({ discountAmount: 5 })], discountAmount: 3 }),
    ).toBe(12);
  });

  it("nunca fica negativo", () => {
    expect(totalDaVenda({ items: [item()], discountAmount: 999 })).toBe(0);
  });

  it("bruto do item ignora desconto", () => {
    expect(brutoDoItem({ quantity: 2.5, unitPrice: 4 })).toBe(10);
  });
});

describe("validação da venda", () => {
  it("venda simples passa", () => {
    expect(vendaSchema.safeParse(venda()).success).toBe(true);
  });

  it("fiado exige cliente", () => {
    expect(vendaSchema.safeParse(venda({ paymentMethod: "FIADO" })).success).toBe(false);
    expect(
      vendaSchema.safeParse(venda({ paymentMethod: "FIADO", customerName: "João" })).success,
    ).toBe(true);
  });

  it("parcela fiada também exige cliente", () => {
    // A parte fiada vira conta a receber, e conta sem nome não é cobrável.
    const misto = venda({
      paymentMethod: "PIX",
      payments: [
        { method: "PIX", amount: 10 },
        { method: "FIADO", amount: 10 },
      ],
    });
    expect(vendaSchema.safeParse(misto).success).toBe(false);
    expect(
      vendaSchema.safeParse({ ...(misto as object), customerName: "João" }).success,
    ).toBe(true);
  });

  // "Caixa plástica exige cliente" depende do módulo de caixas, que o schema
  // não conhece: a regra mora em `VendasService.gravarVenda` e é coberta em
  // tests/integration/venda-pdv-fluxo.test.ts.
  it("caixa plástica sem cliente não é decidida pelo schema", () => {
    expect(vendaSchema.safeParse(venda({ plasticCrateQty: 3 })).success).toBe(true);
  });

  it("as formas de pagamento têm de fechar com o total", () => {
    const errado = venda({
      payments: [
        { method: "PIX", amount: 5 },
        { method: "DINHEIRO", amount: 5 },
      ],
    });
    const r = vendaSchema.safeParse(errado);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.path).toEqual(["payments"]);

    const certo = venda({
      payments: [
        { method: "PIX", amount: 12 },
        { method: "DINHEIRO", amount: 8 },
      ],
    });
    expect(vendaSchema.safeParse(certo).success).toBe(true);
  });

  it("a conferência das parcelas considera o desconto", () => {
    // Total = 20 − 5 = 15. Somar 20 nas parcelas seria cobrar o valor sem desconto.
    const comDesconto = venda({
      discountAmount: 5,
      payments: [{ method: "PIX", amount: 15 }],
    });
    expect(vendaSchema.safeParse(comDesconto).success).toBe(true);
    expect(
      vendaSchema.safeParse(venda({ discountAmount: 5, payments: [{ method: "PIX", amount: 20 }] }))
        .success,
    ).toBe(false);
  });

  it("tolera diferença de centavo na divisão", () => {
    const terco = venda({
      items: [item({ quantity: 1, unitPrice: 10 })],
      payments: [
        { method: "PIX", amount: 3.33 },
        { method: "DINHEIRO", amount: 3.33 },
        { method: "CARTAO", amount: 3.34 },
      ],
    });
    expect(vendaSchema.safeParse(terco).success).toBe(true);
  });

  it("desconto do item não passa do valor do item", () => {
    expect(vendaSchema.safeParse(venda({ items: [item({ discountAmount: 999 })] })).success).toBe(
      false,
    );
  });

  it("desconto da venda não passa do total", () => {
    const r = vendaSchema.safeParse(venda({ discountAmount: 999 }));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.path).toEqual(["discountAmount"]);
  });

  it("preço zero é barrado até haver confirmação explícita", () => {
    // Passava batido e a venda entrava zerada, distorcendo faturamento e lucro.
    expect(vendaSchema.safeParse(venda({ items: [item({ unitPrice: 0 })] })).success).toBe(false);
    expect(
      vendaSchema.safeParse(
        venda({ items: [item({ unitPrice: 0 })], permitirPrecoZero: true }),
      ).success,
    ).toBe(true);
  });

  it("no máximo 4 formas de pagamento", () => {
    const cinco = venda({
      items: [item({ quantity: 1, unitPrice: 5 })],
      payments: [
        { method: "PIX", amount: 1 },
        { method: "DINHEIRO", amount: 1 },
        { method: "CARTAO", amount: 1 },
        { method: "FIADO", amount: 1 },
        { method: "PIX", amount: 1 },
      ],
      customerName: "João",
    });
    expect(vendaSchema.safeParse(cinco).success).toBe(false);
  });

  it("quantidade decimal é aceita (venda por quilo)", () => {
    expect(
      vendaSchema.safeParse(venda({ items: [item({ quantity: 2.35, unitPrice: 8 })] })).success,
    ).toBe(true);
  });
});

describe("formaPredominante", () => {
  it("sem parcelas, usa a forma informada", () => {
    expect(formaPredominante([], "PIX")).toBe("PIX");
  });

  it("qualquer parcela fiada torna a venda fiada", () => {
    // Existe conta a receber; a venda tem de aparecer como fiado nas listas.
    expect(
      formaPredominante(
        [
          { method: "PIX", amount: 90 },
          { method: "FIADO", amount: 10 },
        ],
        "PIX",
      ),
    ).toBe("FIADO");
  });

  it("sem fiado, vence a de maior valor", () => {
    expect(
      formaPredominante(
        [
          { method: "PIX", amount: 30 },
          { method: "DINHEIRO", amount: 70 },
        ],
        "PIX",
      ),
    ).toBe("DINHEIRO");
  });
});

describe("resolvePlasticCrateQty", () => {
  it("usa o valor informado na venda", () => {
    expect(resolvePlasticCrateQty({ plasticCrateQty: 7, items: [] } as unknown as VendaInput)).toBe(
      7,
    );
  });

  it("sem valor informado, soma só os itens em caixa PLÁSTICA", () => {
    const input = {
      items: [
        { productId: "a", quantity: 1, unitPrice: 1, recipientType: "PLASTICA", crateQty: 4 },
        { productId: "b", quantity: 1, unitPrice: 1, recipientType: "PAPELAO", crateQty: 9 },
        { productId: "c", quantity: 1, unitPrice: 1, recipientType: "PLASTICA", crateQty: 2 },
      ],
    } as unknown as VendaInput;
    expect(resolvePlasticCrateQty(input)).toBe(6);
  });
});

describe("caixas plasticas informadas por item (regressao)", () => {
  const itensComCaixa = [
    { productId: "a", quantity: 1, unitPrice: 10, recipientType: "PLASTICA", crateQty: 8 },
  ];

  // O PDV manda `plasticCrateQty: 0` SEMPRE que o checkbox esta desmarcado.
  // Com o teste antigo (`!== undefined`) o zero vencia a soma por item, e as 8
  // caixas saiam do box sem nenhum PlasticCrateMovement — apesar de ficarem
  // gravadas em sale_items.crateQty e aparecerem na tela de detalhe.
  it("zero nao apaga as caixas declaradas nos itens", () => {
    expect(
      resolvePlasticCrateQty({ plasticCrateQty: 0, items: itensComCaixa } as unknown as VendaInput),
    ).toBe(8);
  });

  it("um valor informado de verdade continua vencendo", () => {
    expect(
      resolvePlasticCrateQty({ plasticCrateQty: 3, items: itensComCaixa } as unknown as VendaInput),
    ).toBe(3);
  });

  // "Caixa exige cliente" saiu do schema e foi para o servico, que sabe se a
  // empresa tem o modulo de caixas: o refine barrava a venda de balcao de quem
  // nem controla caixa. A recusa (com o modulo ligado) e a passagem (sem ele)
  // estao em tests/integration/venda-pdv-fluxo.test.ts.
  it("caixa por item sem cliente nao e barrada pelo schema (o servico decide)", () => {
    const r = vendaSchema.safeParse(
      venda({ paymentMethod: "DINHEIRO", items: itensComCaixa as never, customerName: null }),
    );
    expect(r.success).toBe(true);
  });

  it("caixa por item com cliente passa", () => {
    const r = vendaSchema.safeParse(
      venda({ paymentMethod: "DINHEIRO", items: itensComCaixa as never, customerName: "Joao" }),
    );
    expect(r.success).toBe(true);
  });
});

describe("troco: conferido contra a parte em especie, nao contra o total", () => {
  // Venda de R$ 100: R$ 60 em PIX + R$ 40 em dinheiro.
  const mista = (amountReceived: number | null) =>
    venda({
      paymentMethod: "PIX",
      items: [{ productId: "p1", quantity: 1, unitPrice: 100 }],
      payments: [
        { method: "PIX", amount: 60 },
        { method: "DINHEIRO", amount: 40 },
      ],
      amountReceived,
    });

  // Este era o bloqueio: o cliente entrega R$ 50 pela parte de R$ 40 em especie
  // e o sistema recusava, porque comparava com o total de R$ 100.
  it("aceita nota de 50 para a parte de 40 em especie", () => {
    expect(vendaSchema.safeParse(mista(50)).success).toBe(true);
  });

  it("recusa recebido menor que a parte em especie", () => {
    expect(vendaSchema.safeParse(mista(30)).success).toBe(false);
  });

  it("recusa troco absurdo (dedo escorregado no teclado)", () => {
    // 999999999 numa venda de R$ 100 gravava troco de R$ 999.999.899.
    expect(vendaSchema.safeParse(mista(999999999)).success).toBe(false);
  });

  it("recusa recebido quando nada foi pago em especie", () => {
    const r = vendaSchema.safeParse(
      venda({
        paymentMethod: "PIX",
        items: [{ productId: "p1", quantity: 1, unitPrice: 100 }],
        payments: [{ method: "PIX", amount: 100 }],
        amountReceived: 200,
      }),
    );
    expect(r.success).toBe(false);
  });

  it("forma unica em dinheiro continua valendo como antes", () => {
    // A parte em especie e o total inteiro, entao pagar 100 numa venda de 20 passa.
    expect(vendaSchema.safeParse(venda({ amountReceived: 100 })).success).toBe(true);
    expect(vendaSchema.safeParse(venda({ amountReceived: 10 })).success).toBe(false);
  });
});

describe("tolerancia das parcelas medida em centavos", () => {
  const dez = { productId: "p1", quantity: 1, unitPrice: 10 };

  it("aceita a divisao que nao fecha exata em centavos", () => {
    const r = vendaSchema.safeParse(
      venda({
        paymentMethod: "PIX",
        items: [dez],
        payments: [
          { method: "PIX", amount: 3.33 },
          { method: "DINHEIRO", amount: 3.33 },
          { method: "CARTAO", amount: 3.33 },
        ],
      }),
    );
    expect(r.success).toBe(true);
  });

  it("recusa quando a diferenca passa de um centavo", () => {
    const r = vendaSchema.safeParse(
      venda({
        paymentMethod: "PIX",
        items: [dez],
        payments: [{ method: "PIX", amount: 9.5 }],
      }),
    );
    expect(r.success).toBe(false);
  });
});

describe("datas da venda e do fiado: so data que existe (regressao)", () => {
  // `z.string()` puro aceitava "2026-02-31", que o servico gravava como 03/03,
  // e "31/12/2026", que estourava no Prisma como 500.
  it("vendaSchema recusa saleDate e dueDate impossiveis ou em outro formato", () => {
    for (const d of ["2026-02-31", "2026-04-31", "31/12/2026"]) {
      expect(vendaSchema.safeParse(venda({ saleDate: d })).success).toBe(false);
      expect(vendaSchema.safeParse(venda({ dueDate: d })).success).toBe(false);
    }
  });

  it("vendaSchema aceita data real, vazia ou ausente", () => {
    expect(vendaSchema.safeParse(venda({ saleDate: "2028-02-29" })).success).toBe(true);
    expect(vendaSchema.safeParse(venda({ dueDate: null })).success).toBe(true);
    expect(vendaSchema.safeParse(venda({ dueDate: "" })).success).toBe(true);
    expect(vendaSchema.safeParse(venda()).success).toBe(true);
  });

  const fiado = (patch: Record<string, unknown> = {}) => ({
    customerName: "Joao",
    saleDate: "2026-09-10",
    items: [{ productId: "p1", quantity: 1, unitPrice: 10 }],
    ...patch,
  });

  it("fiadoManualSchema recusa data impossivel na venda e no vencimento", () => {
    expect(fiadoManualSchema.safeParse(fiado()).success).toBe(true);
    expect(fiadoManualSchema.safeParse(fiado({ saleDate: "2026-02-31" })).success).toBe(false);
    expect(fiadoManualSchema.safeParse(fiado({ dueDate: "2026-04-31" })).success).toBe(false);
    expect(fiadoUpdateSchema.safeParse({ id: "x", dueDate: "2026-02-30" }).success).toBe(false);
    expect(
      devolucaoCaixasSchema.safeParse({ accountId: "x", quantity: 1, movementDate: "10/09/2026" })
        .success,
    ).toBe(false);
  });
});

describe("fiado manual exige preco em todo item (regressao)", () => {
  // O formulario abre a linha com preco 0. Com tudo zerado, a venda, a baixa de
  // estoque e as caixas eram gravadas e a tela respondia erro; cada nova
  // tentativa baixava o estoque de novo.
  const fiado = (items: { productId: string; quantity: number; unitPrice: number }[]) => ({
    customerName: "Joao",
    saleDate: "2026-09-10",
    items,
  });

  it("recusa item com preco zero, sozinho ou entre outros", () => {
    const r = fiadoManualSchema.safeParse(fiado([{ productId: "p1", quantity: 1, unitPrice: 0 }]));
    expect(r.success).toBe(false);
    expect(
      fiadoManualSchema.safeParse(
        fiado([
          { productId: "p1", quantity: 1, unitPrice: 10 },
          { productId: "p2", quantity: 1, unitPrice: 0 },
        ]),
      ).success,
    ).toBe(false);
  });

  it("aceita quando todos os itens tem preco", () => {
    expect(
      fiadoManualSchema.safeParse(fiado([{ productId: "p1", quantity: 1, unitPrice: 0.5 }])).success,
    ).toBe(true);
  });
});
