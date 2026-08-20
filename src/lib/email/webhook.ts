import crypto from "node:crypto";

/**
 * Verificação de assinatura dos webhooks do Resend.
 *
 * O Resend assina os webhooks no padrão Svix. Cada requisição traz 3 headers:
 *   svix-id, svix-timestamp, svix-signature
 * e o conteúdo assinado é `${id}.${timestamp}.${rawBody}`.
 *
 * O secret do painel tem o formato `whsec_<base64>`. A parte após o prefixo é
 * decodificada de base64 e usada como chave do HMAC-SHA256. A assinatura esperada
 * é o digest em base64. O header svix-signature pode conter várias assinaturas
 * separadas por espaço, cada uma no formato `v1,<base64>` — basta uma bater.
 *
 * Implementação manual com node:crypto para não adicionar dependência (mesmo
 * padrão do HMAC do webhook do Mercado Pago).
 */

const WEBHOOK_TOLERANCE_SECONDS = 5 * 60; // 5 min de tolerância de clock (padrão Svix)

export interface VerifyResendSignatureArgs {
  /** Header svix-id. */
  id: string | null;
  /** Header svix-timestamp (epoch em segundos, como string). */
  timestamp: string | null;
  /** Header svix-signature (ex.: "v1,abc123 v1,def456"). */
  signature: string | null;
  /** Corpo cru da requisição (exatamente como recebido — não reserializar!). */
  payload: string;
  /** RESEND_WEBHOOK_SECRET, no formato whsec_... */
  secret: string | undefined;
}

export function verifyResendSignature({
  id,
  timestamp,
  signature,
  payload,
  secret,
}: VerifyResendSignatureArgs): boolean {
  if (!id || !timestamp || !signature || !secret) return false;

  // 1) Rejeita timestamps fora da janela de tolerância (proteção contra replay).
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > WEBHOOK_TOLERANCE_SECONDS) return false;

  // 2) Decodifica o secret (parte após "whsec_").
  const secretBytes = base64ToBuffer(secret.startsWith("whsec_") ? secret.slice(6) : secret);
  if (!secretBytes) return false;

  // 3) Calcula a assinatura esperada sobre `${id}.${timestamp}.${payload}`.
  const signedContent = `${id}.${timestamp}.${payload}`;
  const expected = crypto.createHmac("sha256", secretBytes).update(signedContent).digest();

  // 4) Compara (tempo constante) contra cada assinatura enviada no header.
  for (const part of signature.split(" ")) {
    const comma = part.indexOf(",");
    const value = comma === -1 ? part : part.slice(comma + 1); // remove o prefixo "v1,"
    const provided = base64ToBuffer(value);
    if (provided && provided.length === expected.length && crypto.timingSafeEqual(provided, expected)) {
      return true;
    }
  }
  return false;
}

function base64ToBuffer(value: string): Buffer | null {
  try {
    const buf = Buffer.from(value, "base64");
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}
