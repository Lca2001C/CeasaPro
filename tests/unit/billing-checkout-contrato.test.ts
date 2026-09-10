import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { checkoutSchema, cardPaymentSchema } from "@/lib/validations/billing";

/**
 * O contrato das rotas de checkout — o que o cliente pode e não pode mandar.
 *
 * As duas rotas (`/api/billing/checkout` e `/api/billing/checkout/card`) são
 * finas: validam com Zod e delegam ao `BillingService` através de
 * `withTenantRoute`. O wrapper já tem teste próprio, então o que sobra de
 * risco aqui é o CONTRATO — e ele guarda três coisas que, quebradas, custam
 * dinheiro ou barram receita.
 *
 * Nenhuma das duas era exercitada por teste antes desta auditoria.
 */

const BASE_PIX = { method: "PIX" as const, acceptedTerms: true as const };
const BASE_CARTAO = {
  method: "CREDIT_CARD" as const,
  token: "tok_123",
  paymentMethodId: "visa",
  installments: 1,
  payer: { email: "dono@box.com" },
  acceptedTerms: true as const,
};

describe("o valor NUNCA vem do cliente", () => {
  /*
    A regra que impede alguém de pagar a mensalidade por um centavo.

    O preço sai de `prepareCharge(tenantId, planId, …)`, que lê o plano no
    banco. O schema não tem campo de valor — e, como o Zod descarta chave
    desconhecida por padrão, mandar um valor no corpo não vira nada. O teste
    fixa as duas metades: que o campo não existe, e que enviá-lo é inofensivo.
  */
  const camposDeDinheiro = ["amount", "value", "price", "monthlyAmount", "valor", "preco", "total"];

  it("o schema do PIX não tem campo de valor", () => {
    for (const campo of camposDeDinheiro) {
      expect(Object.keys(checkoutSchema.shape), campo).not.toContain(campo);
    }
  });

  it("o schema do cartão não tem campo de valor", () => {
    /*
      Verificado por COMPORTAMENTO, e não espiando `_def`: a estrutura interna
      do Zod muda entre versões maiores (no 4 o `.refine()` deixou de expor
      `_def.schema`), e um teste que depende dela quebra num upgrade sem que
      nada de errado tenha acontecido com o contrato.
    */
    const entrada = { ...BASE_CARTAO } as Record<string, unknown>;
    for (const campo of camposDeDinheiro) entrada[campo] = 0.01;

    const saida = cardPaymentSchema.parse(entrada) as Record<string, unknown>;
    for (const campo of camposDeDinheiro) {
      expect(saida, campo).not.toHaveProperty(campo);
    }
  });

  it("mandar um valor no corpo é DESCARTADO, não honrado", () => {
    const saida = checkoutSchema.parse({ ...BASE_PIX, amount: 0.01, price: 0.01 });
    expect(saida).not.toHaveProperty("amount");
    expect(saida).not.toHaveProperty("price");
  });

  it("o mesmo vale para o cartão", () => {
    const saida = cardPaymentSchema.parse({ ...BASE_CARTAO, amount: 0.01 });
    expect(saida).not.toHaveProperty("amount");
  });
});

describe("consentimento dos Termos", () => {
  /*
    `acceptedTerms` é `z.literal(true)`, validado no SERVIDOR e não só no
    formulário: é a prova de consentimento exigida pela LGPD. Omitir ou
    falsificar não pode passar.
  */
  it("não dá para omitir", () => {
    expect(checkoutSchema.safeParse({ method: "PIX" }).success).toBe(false);
    const semTermos = { ...BASE_CARTAO } as Record<string, unknown>;
    delete semTermos.acceptedTerms;
    expect(cardPaymentSchema.safeParse(semTermos).success).toBe(false);
  });

  it("não dá para mandar `false`, `\"true\"` ou 1", () => {
    for (const valor of [false, "true", 1, null]) {
      expect(
        checkoutSchema.safeParse({ ...BASE_PIX, acceptedTerms: valor }).success,
        String(valor),
      ).toBe(false);
    }
  });

  it("a mensagem explica o que falta", () => {
    const r = checkoutSchema.safeParse({ method: "PIX", acceptedTerms: false });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.message).toMatch(/Termos de Uso/i);
  });
});

describe("regras do cartão", () => {
  it("débito não parcela", () => {
    // Emissor brasileiro recusa débito parcelado; deixar passar viraria erro
    // do gateway no meio do pagamento, com o cliente achando que pagou.
    const r = cardPaymentSchema.safeParse({
      ...BASE_CARTAO,
      method: "DEBIT_CARD",
      installments: 3,
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.path).toEqual(["installments"]);
  });

  it("débito em 1x passa", () => {
    expect(
      cardPaymentSchema.safeParse({ ...BASE_CARTAO, method: "DEBIT_CARD", installments: 1 }).success,
    ).toBe(true);
  });

  it("recusa parcelamento fora da faixa", () => {
    for (const n of [0, -1, 13, 1.5]) {
      expect(
        cardPaymentSchema.safeParse({ ...BASE_CARTAO, installments: n }).success,
        String(n),
      ).toBe(false);
    }
  });

  it("o servidor recebe TOKEN, nunca número de cartão", () => {
    /*
      O Payment Brick tokeniza no browser. Um campo de número ou CVV no schema
      significaria dado de cartão trafegando e possivelmente sendo logado —
      é o limite entre estar e não estar no escopo do PCI DSS.
    */
    const PROIBIDOS = ["cardNumber", "number", "cvv", "securityCode", "expirationMonth"];
    const entrada = { ...BASE_CARTAO } as Record<string, unknown>;
    for (const campo of PROIBIDOS) entrada[campo] = "4111111111111111";

    const saida = cardPaymentSchema.parse(entrada) as Record<string, unknown>;

    expect(saida.token).toBe("tok_123");
    for (const proibido of PROIBIDOS) {
      expect(saida, proibido).not.toHaveProperty(proibido);
    }
  });

  it("PIX não é aceito no endpoint de cartão", () => {
    expect(cardPaymentSchema.safeParse({ ...BASE_CARTAO, method: "PIX" }).success).toBe(false);
  });
});

describe("as rotas de pagamento aceitam quem está bloqueado", () => {
  it("as duas declaram `allowInactive`", () => {
    /*
      Lê o fonte porque é omissão de cadastro: tirar a linha não quebra tipo
      nem teste de unidade, e o efeito só aparece com um cliente suspenso
      tentando pagar — que é justamente quem a plataforma mais quer que pague.
      Sem ela, `withTenantRoute` devolve 402 e o inadimplente fica preso sem
      caminho de regularização.

      `with-route.test.ts` já prova que a opção FUNCIONA; este teste prova que
      ela está DECLARADA onde precisa.
    */
    const rotas = [
      "src/app/api/billing/checkout/route.ts",
      "src/app/api/billing/checkout/card/route.ts",
    ];
    const semExcecao = rotas.filter(
      (r) => !/allowInactive:\s*true/.test(readFileSync(r, "utf8")),
    );
    expect(semExcecao, "rota de pagamento que barra cliente bloqueado").toEqual([]);
  });

  it("e continuam passando pelo envelope de tenant", () => {
    // `allowInactive` afrouxa a COBRANÇA, não a identidade: o `tenantId` tem
    // de continuar vindo da sessão.
    for (const r of [
      "src/app/api/billing/checkout/route.ts",
      "src/app/api/billing/checkout/card/route.ts",
    ]) {
      const fonte = readFileSync(r, "utf8");
      expect(fonte, r).toContain("withTenantRoute");
      expect(fonte, r).toContain("ctx.tenantId");
    }
  });
});
