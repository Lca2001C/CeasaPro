import { MercadoPagoConfig, Payment, Preference } from "mercadopago";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { describeError, logger } from "@/lib/logger";

/**
 * Integração Mercado Pago — PIX, cartão de crédito e cartão de débito (com 3DS).
 * O token é lido a cada chamada (e não no import) para não congelar a
 * configuração no cold start de ambientes serverless.
 */

/** Tolerância do timestamp do webhook — protege contra replay de assinatura. */
export const WEBHOOK_MAX_SKEW_SECONDS = 300;

function accessToken(): string | undefined {
  return process.env.MERCADOPAGO_ACCESS_TOKEN;
}

export function isMercadoPagoConfigured(): boolean {
  return Boolean(accessToken());
}

function mpConfig(): MercadoPagoConfig {
  const token = accessToken();
  if (!token) throw new Error("MERCADOPAGO_ACCESS_TOKEN não configurado");
  return new MercadoPagoConfig({ accessToken: token });
}

function paymentClient(): Payment {
  return new Payment(mpConfig());
}

function preferenceClient(): Preference {
  return new Preference(mpConfig());
}

/** Uma entrada de `cause` na resposta de erro da API do Mercado Pago. */
export interface MpErrorCause {
  code: string;
  description: string;
}

/**
 * Erro devolvido pela API do Mercado Pago, já normalizado.
 *
 * O SDK lança o JSON cru da resposta (`throw await response.json()`), um objeto
 * que não é `Error` — sem isto ele chegava ao handler como um valor opaco,
 * virava "[object Object]" no log e "Erro inesperado" na tela. Aqui o detalhe é
 * preservado em campos tipados para o log e para a mensagem ao usuário.
 */
export class MercadoPagoApiError extends Error {
  constructor(
    /** Operação nossa que falhou ("createCardPayment", "getPayment", …). */
    readonly operation: string,
    /** HTTP devolvido pela API (400, 401, 404…). */
    readonly status: number | null,
    /** `cause[]` da resposta — onde está o motivo real da recusa. */
    readonly causes: MpErrorCause[],
    message: string,
  ) {
    super(message);
    this.name = "MercadoPagoApiError";
  }

  /** `true` quando alguma causa bate com um dos códigos informados. */
  hasCause(...codes: string[]): boolean {
    return this.causes.some((c) => codes.includes(c.code));
  }
}

function parseCauses(raw: unknown): MpErrorCause[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c) => {
    if (typeof c !== "object" || c === null) return [];
    const { code, description, message } = c as Record<string, unknown>;
    if (code === undefined && description === undefined) return [];
    return [
      {
        code: String(code ?? ""),
        description: String(description ?? message ?? ""),
      },
    ];
  });
}

/**
 * Executa uma chamada ao Mercado Pago normalizando a falha.
 *
 * Loga a resposta de erro inteira (a API não devolve dado de cartão nesse
 * corpo — só código e descrição) e relança como `MercadoPagoApiError`, para
 * que a camada de serviço decida a mensagem que o usuário vê.
 */
async function mpCall<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    // Só o objeto cru da API vira MercadoPagoApiError. Um `Error` de verdade
    // aqui é falha de rede/timeout (o SDK aborta o fetch), não recusa do
    // gateway — rotulá-lo como "recusado" mandaria o usuário conferir o cartão
    // quando o problema é conectividade.
    if (typeof e === "object" && e !== null && !(e instanceof Error)) {
      const raw = e as Record<string, unknown>;
      const causes = parseCauses(raw.cause);
      const status = typeof raw.status === "number" ? raw.status : null;
      const message =
        (typeof raw.message === "string" && raw.message) ||
        (typeof raw.error === "string" && raw.error) ||
        "Falha na comunicação com o Mercado Pago";
      logger.error(
        { operation, status, causes, mpError: describeError(e) },
        "Mercado Pago recusou a requisição",
      );
      throw new MercadoPagoApiError(operation, status, causes, message);
    }
    logger.error({ operation, err: describeError(e) }, "Falha ao chamar o Mercado Pago");
    throw e;
  }
}

/** URL pública da aplicação — usada em back_urls e notification_url. */
export function appUrl(): string {
  return (
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000"
  ).replace(/\/+$/, "");
}

export function webhookUrl(): string {
  return `${appUrl()}/api/webhooks/mercadopago`;
}

/**
 * Valida a configuração obrigatória em produção. Chamado nas rotas de billing
 * para falhar cedo e com mensagem clara, em vez de gerar cobrança inválida.
 */
export function assertMercadoPagoConfig(): void {
  if (process.env.NODE_ENV !== "production") return;
  const missing: string[] = [];
  if (!process.env.MERCADOPAGO_ACCESS_TOKEN) missing.push("MERCADOPAGO_ACCESS_TOKEN");
  if (!process.env.MERCADOPAGO_WEBHOOK_SECRET) missing.push("MERCADOPAGO_WEBHOOK_SECRET");
  if (!process.env.APP_URL && !process.env.NEXT_PUBLIC_APP_URL) missing.push("APP_URL");
  if (missing.length > 0) {
    throw new Error(`Configuração do Mercado Pago incompleta: ${missing.join(", ")}`);
  }
}

/**
 * Mensagem para o usuário a partir de uma recusa da API.
 *
 * Cobre as recusas que acontecem ANTES de existir pagamento — as que a API
 * rejeita com HTTP 4xx. Recusa do emissor (o pagamento existe e vem com
 * `status: "rejected"`) não passa por aqui: quem traduz é o `status_detail`,
 * em `REJECTION_MESSAGES` no Payment Brick.
 */
export function mercadoPagoErrorMessage(e: MercadoPagoApiError): string {
  // "Invalid users involved": pagador e recebedor são a mesma conta Mercado
  // Pago, ou um é de teste e o outro de produção. É o que acontece ao testar
  // com cartão/usuário de teste contra credencial de produção (APP_USR-), e
  // também ao tentar pagar a própria aplicação com a conta dona dela.
  if (/invalid users involved/i.test(e.message)) {
    return (
      "O Mercado Pago recusou: pagador e recebedor não podem ser a mesma conta. " +
      "Se está testando, use as credenciais de TESTE (TEST-...) com um cartão de teste — " +
      "cartão de teste não funciona com credencial de produção."
    );
  }
  if (e.status === 401 || e.status === 403) {
    return "Credencial do Mercado Pago inválida ou sem permissão. Confira o MERCADOPAGO_ACCESS_TOKEN.";
  }
  if (e.hasCause("3001", "3003", "3004", "2062") || /card_?token/i.test(e.message)) {
    return "Não foi possível validar o cartão. Preencha os dados novamente e tente de novo.";
  }
  if (e.status !== null && e.status >= 500) {
    return "O Mercado Pago está instável no momento. Tente de novo em alguns minutos ou pague com PIX.";
  }
  // Fallback: a descrição do Mercado Pago é mais útil que "erro inesperado".
  const detail = e.causes[0]?.description || e.message;
  return `O Mercado Pago recusou o pagamento: ${detail}`;
}

export interface PixCharge {
  mpPaymentId: string;
  status: string;
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  expiresAt: Date | null;
}

/**
 * Cria uma cobrança PIX no Mercado Pago.
 * `externalReference` é usado como chave de idempotência: repetir a chamada
 * devolve a MESMA cobrança em vez de criar uma segunda.
 */
export async function createPixPayment(args: {
  amount: number;
  description: string;
  payerEmail: string;
  externalReference: string;
  expiresAt: Date;
}): Promise<PixCharge> {
  const client = paymentClient();
  const res = await mpCall("createPixPayment", () => client.create({
    body: {
      transaction_amount: args.amount,
      description: args.description,
      payment_method_id: "pix",
      payer: { email: args.payerEmail },
      external_reference: args.externalReference,
      notification_url: webhookUrl(),
      date_of_expiration: args.expiresAt.toISOString(),
    },
    requestOptions: { idempotencyKey: `pix:${args.externalReference}` },
  }));
  const tx = res.point_of_interaction?.transaction_data;
  return {
    mpPaymentId: String(res.id),
    status: String(res.status ?? "pending"),
    qrCode: tx?.qr_code ?? null,
    qrCodeBase64: tx?.qr_code_base64 ?? null,
    ticketUrl: tx?.ticket_url ?? null,
    expiresAt: res.date_of_expiration ? new Date(res.date_of_expiration) : args.expiresAt,
  };
}

export interface CardCheckout {
  preferenceId: string;
  initPoint: string | null;
}

/**
 * Cria uma preferência de Checkout Pro (cartão de crédito/débito).
 * O pagamento resultante chega pelo mesmo webhook, correlacionado por
 * `external_reference`.
 *
 * INATIVA: o checkout de cartão hoje é feito pelo Payment Brick
 * (`createCardPayment`). Mantida para o caso de o Checkout Pro voltar como
 * alternativa de fallback — nenhuma rota a importa no momento.
 */
export async function createCardPreference(args: {
  amount: number;
  description: string;
  payerEmail: string;
  externalReference: string;
  expiresAt: Date;
}): Promise<CardCheckout> {
  const client = preferenceClient();
  const base = appUrl();
  const res = await mpCall("createCardPreference", () => client.create({
    body: {
      items: [
        {
          id: args.externalReference,
          title: args.description,
          quantity: 1,
          currency_id: "BRL",
          unit_price: args.amount,
        },
      ],
      payer: { email: args.payerEmail },
      external_reference: args.externalReference,
      notification_url: webhookUrl(),
      back_urls: {
        success: `${base}/assinatura?pagamento=sucesso`,
        pending: `${base}/assinatura?pagamento=pendente`,
        failure: `${base}/assinatura?pagamento=falha`,
      },
      auto_return: "approved",
      binary_mode: true,
      expires: true,
      expiration_date_to: args.expiresAt.toISOString(),
      payment_methods: { excluded_payment_types: [{ id: "ticket" }] },
    },
    requestOptions: { idempotencyKey: `card:${args.externalReference}` },
  }));
  return {
    preferenceId: String(res.id),
    initPoint: res.init_point ?? res.sandbox_init_point ?? null,
  };
}

/** Tipo de cartão aceito — define se o Mercado Pago negocia o desafio 3DS. */
export type CardPaymentTypeId = "credit_card" | "debit_card";

/** Desafio 3-D Secure devolvido pelo emissor (débito). */
export interface ThreeDsChallenge {
  externalResourceUrl: string;
  creq: string;
}

export interface CardCharge {
  mpPaymentId: string;
  status: string;
  statusDetail: string | null;
  threeDs: ThreeDsChallenge | null;
}

export interface CardPayer {
  email: string;
  firstName?: string;
  lastName?: string;
  identification?: { type: string; number: string };
}

/**
 * Extrai o desafio 3DS da resposta do Mercado Pago.
 * O SDK declara `three_ds_info` apontando para um tipo que não exporta, então
 * a leitura é feita sobre `unknown` com type guard — sem `any`.
 */
function extractThreeDs(payment: unknown): ThreeDsChallenge | null {
  if (typeof payment !== "object" || payment === null) return null;
  const info = (payment as { three_ds_info?: unknown }).three_ds_info;
  if (typeof info !== "object" || info === null) return null;
  const { external_resource_url: url, creq } = info as {
    external_resource_url?: unknown;
    creq?: unknown;
  };
  if (typeof url !== "string" || url.length === 0) return null;
  return { externalResourceUrl: url, creq: typeof creq === "string" ? creq : "" };
}

/**
 * Chave de idempotência determinística do cartão: retentar o MESMO cartão na
 * mesma cobrança não duplica o débito; trocar de cartão gera uma nova tentativa.
 * (`randomUUID` anularia a proteção, já que toda chamada seria "nova".)
 */
function cardIdempotencyKey(externalReference: string, token: string): string {
  return createHash("sha256").update(`${externalReference}:${token}`).digest("hex");
}

/**
 * Cria um pagamento com CARTÃO (crédito ou débito) a partir do token do Brick.
 * PCI: o servidor recebe apenas o `token` — nunca número/CVV/validade.
 * No débito enviamos `three_d_secure_mode: "optional"`: o Mercado Pago devolve
 * o desafio 3DS quando o emissor exige e aprova direto quando não exige.
 */
export async function createCardPayment(args: {
  amount: number;
  description: string;
  externalReference: string;
  token: string;
  paymentMethodId: string;
  paymentTypeId: CardPaymentTypeId;
  issuerId?: string;
  installments: number;
  payer: CardPayer;
}): Promise<CardCharge> {
  const client = paymentClient();
  const issuer = args.issuerId ? Number(args.issuerId) : NaN;
  const res = await mpCall("createCardPayment", () => client.create({
    body: {
      transaction_amount: args.amount,
      token: args.token,
      description: args.description,
      installments: args.installments,
      payment_method_id: args.paymentMethodId,
      ...(Number.isFinite(issuer) ? { issuer_id: issuer } : {}),
      ...(args.paymentTypeId === "debit_card" ? { three_d_secure_mode: "optional" } : {}),
      payer: {
        email: args.payer.email,
        ...(args.payer.firstName ? { first_name: args.payer.firstName } : {}),
        ...(args.payer.lastName ? { last_name: args.payer.lastName } : {}),
        ...(args.payer.identification ? { identification: args.payer.identification } : {}),
      },
      external_reference: args.externalReference,
      notification_url: webhookUrl(),
    },
    requestOptions: {
      idempotencyKey: cardIdempotencyKey(args.externalReference, args.token),
    },
  }));
  return {
    mpPaymentId: String(res.id),
    status: String(res.status ?? "pending"),
    statusDetail: res.status_detail ?? null,
    threeDs: extractThreeDs(res),
  };
}

/** Busca um pagamento no Mercado Pago (fonte da verdade do status). */
export async function getPayment(id: string) {
  const client = paymentClient();
  const res = await mpCall("getPayment", () => client.get({ id }));
  return {
    id: String(res.id),
    status: String(res.status ?? ""),
    statusDetail: res.status_detail ?? null,
    externalReference: res.external_reference ?? null,
    amount: res.transaction_amount ?? 0,
    method: res.payment_method_id ?? null,
    paymentTypeId: res.payment_type_id ?? null,
    paidAt: res.date_approved ? new Date(res.date_approved) : null,
  };
}

export type MpPayment = Awaited<ReturnType<typeof getPayment>>;

/**
 * Valida a assinatura HMAC do webhook do Mercado Pago.
 * Header x-signature: "ts=<ts>,v1=<hash>"; manifest = id:<dataId>;request-id:<reqId>;ts:<ts>;
 * Além do HMAC, o timestamp precisa ser recente (anti-replay).
 */
export function verifyWebhookSignature(args: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
  now?: Date;
}): boolean {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      logger.error("MERCADOPAGO_WEBHOOK_SECRET ausente em produção — webhook rejeitado.");
      return false;
    }
    logger.warn("MERCADOPAGO_WEBHOOK_SECRET ausente — pulando verificação (apenas dev).");
    return true;
  }
  if (!args.xSignature || !args.dataId) return false;

  const parts = Object.fromEntries(
    args.xSignature.split(",").map((kv) => {
      const [k, v] = kv.split("=");
      return [k?.trim(), v?.trim()];
    }),
  );
  const ts = parts["ts"];
  const v1 = parts["v1"];
  if (!ts || !v1) return false;

  // Anti-replay: o Mercado Pago envia o ts em segundos (epoch).
  const tsSeconds = Number(ts);
  if (!Number.isFinite(tsSeconds)) return false;
  const nowSeconds = Math.floor((args.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - tsSeconds) > WEBHOOK_MAX_SKEW_SECONDS) {
    logger.warn({ ts }, "Webhook Mercado Pago com timestamp fora da janela");
    return false;
  }

  // O Mercado Pago calcula o HMAC com o `data.id` em MINÚSCULAS quando ele é
  // alfanumérico. Id de pagamento é numérico e não muda com isto, mas outros
  // tópicos (merchant_order, por exemplo) chegam ao mesmo endpoint e seriam
  // rejeitados com 401 — o que faz o Mercado Pago reenviar sem parar e, no
  // limite, desativar a assinatura do webhook.
  const dataId = args.dataId.toLowerCase();
  const manifest = `id:${dataId};request-id:${args.xRequestId ?? ""};ts:${ts};`;
  const hmac = createHmac("sha256", secret).update(manifest).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(hmac), Buffer.from(v1));
  } catch {
    return false;
  }
}
