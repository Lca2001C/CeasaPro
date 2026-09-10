import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * O handler do webhook do Mercado Pago — o único caminho que confirma pagamento.
 *
 * A assinatura HMAC já tinha teste (`mp-webhook-signature.test.ts`, 17 casos) e
 * a lógica de cobrança também (`mercadopago-webhook.test.ts`). O que ninguém
 * executava era **o handler que orquestra os dois**: quem lê o id, quem decide
 * qual id vai para a verificação, quem descarta evento que não é pagamento e
 * quem manda processar.
 *
 * É a rota mais sensível do sistema. Ela está em `PUBLIC_PREFIXES` — o Mercado
 * Pago chega sem cookie — então toda a autenticação é o HMAC. Se ela errar, ou
 * a plataforma libera acesso sem receber, ou deixa de liberar quem pagou.
 */

const verifyWebhookSignature = vi.fn();
const handleWebhook = vi.fn();
/** Callbacks que o handler agendou para depois da resposta. */
const agendados: (() => Promise<void> | void)[] = [];

vi.mock("next/server", async () => {
  const real = await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...real,
    // `after()` roda DEPOIS da resposta sair. Aqui ele é capturado para o teste
    // poder disparar na hora que quiser — inclusive para afirmar que NÃO houve
    // agendamento quando a assinatura falha.
    after: (fn: () => Promise<void> | void) => {
      agendados.push(fn);
    },
  };
});
vi.mock("@/lib/payments/mercadopago", () => ({
  verifyWebhookSignature: (a: unknown) => verifyWebhookSignature(a),
}));
vi.mock("@/lib/services/billing.service", () => ({
  BillingService: { handleWebhook: (id: string) => handleWebhook(id) },
}));

const { POST } = await import("@/app/api/webhooks/mercadopago/route");

/** Dispara o que o handler agendou, como o runtime faria após a resposta. */
async function rodarAgendados() {
  for (const fn of agendados.splice(0)) await fn();
}

function notificacao(opts: {
  corpo?: unknown;
  query?: string;
  headers?: Record<string, string>;
  corpoCru?: string;
}) {
  return new Request(`http://localhost/api/webhooks/mercadopago${opts.query ?? ""}`, {
    method: "POST",
    headers: {
      "x-signature": "ts=1,v1=abc",
      "x-request-id": "req-1",
      ...opts.headers,
    },
    body: opts.corpoCru ?? JSON.stringify(opts.corpo ?? {}),
  });
}

beforeEach(() => {
  agendados.length = 0;
  handleWebhook.mockResolvedValue({ resultado: "ok" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("assinatura inválida", () => {
  it("devolve 401 e NÃO agenda processamento", async () => {
    verifyWebhookSignature.mockReturnValue(null);

    const r = await POST(notificacao({ corpo: { type: "payment", data: { id: "123" } } }));

    expect(r.status).toBe(401);
    expect(agendados).toHaveLength(0);
    expect(handleWebhook).not.toHaveBeenCalled();
  });

  it("sem cabeçalho de assinatura também é 401", async () => {
    verifyWebhookSignature.mockReturnValue(null);
    const r = await POST(
      new Request("http://localhost/api/webhooks/mercadopago", {
        method: "POST",
        body: JSON.stringify({ type: "payment", data: { id: "123" } }),
      }),
    );
    expect(r.status).toBe(401);
    expect(handleWebhook).not.toHaveBeenCalled();
  });
});

describe("qual id é processado", () => {
  it("processa o id que PASSOU no HMAC, nunca o do corpo", async () => {
    /*
      A propriedade mais importante deste arquivo, e a razão de
      `verifyWebhookSignature` devolver o id em vez de um booleano.

      O ataque que isso fecha: apresentar uma assinatura legítima de um
      pagamento pequeno (ou de outra conta) e mandar no CORPO o id de um
      pagamento que se quer ver confirmado. Se o handler verificasse um id e
      processasse outro, a plataforma liberaria acesso por um pagamento que
      não é daquele cliente.

      O comentário no fonte registra que esse defeito já existiu aqui.
    */
    verifyWebhookSignature.mockReturnValue("id-que-assinou");

    const r = await POST(
      notificacao({
        query: "?data.id=id-que-assinou",
        corpo: { type: "payment", data: { id: "id-FORJADO-no-corpo" } },
      }),
    );
    await rodarAgendados();

    expect(r.status).toBe(200);
    expect(handleWebhook).toHaveBeenCalledWith("id-que-assinou");
    expect(handleWebhook).not.toHaveBeenCalledWith("id-FORJADO-no-corpo");
  });

  it("manda os dois candidatos para a verificação decidir", async () => {
    // A assinatura é calculada sobre o id da QUERY, mas nem toda notificação a
    // traz. Por isso o handler oferece query e corpo, e quem escolhe é a
    // verificação — não o handler.
    verifyWebhookSignature.mockReturnValue("123");

    await POST(
      notificacao({ query: "?data.id=123", corpo: { type: "payment", data: { id: "456" } } }),
    );

    const arg = verifyWebhookSignature.mock.calls[0]![0];
    expect(arg.dataId).toBe("123");
    expect(arg.dataIdAlt).toBe("456");
  });

  it("sem id na query, usa o do corpo como candidato", async () => {
    verifyWebhookSignature.mockReturnValue("789");
    await POST(notificacao({ corpo: { type: "payment", data: { id: 789 } } }));

    const arg = verifyWebhookSignature.mock.calls[0]![0];
    // Number no corpo vira string: o id do MP chega dos dois jeitos.
    expect(arg.dataId).toBe("789");
  });

  it("aceita `?id=` além de `?data.id=`", async () => {
    verifyWebhookSignature.mockReturnValue("555");
    await POST(notificacao({ query: "?id=555", corpo: {} }));
    expect(verifyWebhookSignature.mock.calls[0]![0].dataId).toBe("555");
  });
});

describe("que evento é processado", () => {
  it("evento que não é pagamento sai com 200 sem processar", async () => {
    // O MP manda merchant_order, plan, subscription… Processar tudo faria a
    // reconciliação consultar a API por um id que não é de pagamento.
    verifyWebhookSignature.mockReturnValue("id-1");

    const r = await POST(notificacao({ corpo: { type: "merchant_order", data: { id: "id-1" } } }));
    await rodarAgendados();

    expect(r.status).toBe(200);
    expect(handleWebhook).not.toHaveBeenCalled();
  });

  it("sem `type` nenhum, processa mesmo assim", async () => {
    // Notificação sem tipo existe; descartá-la perderia confirmação de
    // pagamento, que é pior que consultar a API à toa.
    verifyWebhookSignature.mockReturnValue("id-1");

    await POST(notificacao({ corpo: { data: { id: "id-1" } } }));
    await rodarAgendados();

    expect(handleWebhook).toHaveBeenCalledWith("id-1");
  });

  it("aceita `topic` da IPN legada como se fosse `type`", async () => {
    verifyWebhookSignature.mockReturnValue("id-1");

    await POST(notificacao({ query: "?topic=payment&data.id=id-1", corpo: {} }));
    await rodarAgendados();

    expect(handleWebhook).toHaveBeenCalledWith("id-1");
  });

  it("`topic` que não é pagamento também é descartado", async () => {
    verifyWebhookSignature.mockReturnValue("id-1");
    await POST(notificacao({ query: "?topic=merchant_order&data.id=id-1", corpo: {} }));
    await rodarAgendados();
    expect(handleWebhook).not.toHaveBeenCalled();
  });
});

describe("resposta e processamento assíncrono", () => {
  it("responde 200 ANTES de processar", async () => {
    /*
      O Mercado Pago reenvia o evento se a resposta demorar, e reprocessar é
      trabalho à toa (a idempotência por `mpPaymentId` aguenta, mas o custo é
      real). Confirmar a entrega na hora e processar depois é o desenho.
    */
    verifyWebhookSignature.mockReturnValue("id-1");

    const r = await POST(notificacao({ corpo: { type: "payment", data: { id: "id-1" } } }));

    expect(r.status).toBe(200);
    // Ainda não rodou: está agendado para depois da resposta.
    expect(handleWebhook).not.toHaveBeenCalled();
    expect(agendados).toHaveLength(1);

    await rodarAgendados();
    expect(handleWebhook).toHaveBeenCalledWith("id-1");
  });

  it("falha no processamento NÃO muda a resposta — o cron reconcilia", async () => {
    /*
      Devolver erro faria o MP reenviar em laço enquanto o defeito durasse. O
      caminho de recuperação é a reconciliação diária do cron de billing, que
      cura webhook perdido nos dois sentidos.
    */
    verifyWebhookSignature.mockReturnValue("id-1");
    handleWebhook.mockRejectedValue(new Error("banco fora"));

    const r = await POST(notificacao({ corpo: { type: "payment", data: { id: "id-1" } } }));
    expect(r.status).toBe(200);

    // E o erro não escapa para o runtime.
    await expect(rodarAgendados()).resolves.toBeUndefined();
  });

  it("corpo que não é JSON não derruba o handler", async () => {
    // O MP manda `application/json`, mas um proxy no meio pode entregar corpo
    // truncado. Sem o catch, isso viraria 500 e o MP reenviaria em laço.
    verifyWebhookSignature.mockReturnValue("id-1");

    const r = await POST(notificacao({ query: "?data.id=id-1", corpoCru: "{ truncado" }));

    expect(r.status).toBe(200);
  });
});
