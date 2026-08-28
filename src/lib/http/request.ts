import { headers } from "next/headers";

/**
 * Quantos proxies CONFIÁVEIS existem na frente da aplicação.
 *
 * 1 é o certo para Vercel, ou para um Nginx/Caddy próprio. Aumente só se houver
 * mais de uma camada que acrescente ao `x-forwarded-for` (ex.: CDN + reverse
 * proxy = 2).
 */
function hopsConfiaveis(): number {
  return Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS ?? "1") || 1);
}

/**
 * Resolve o IP do cliente a partir dos dois cabeçalhos, sem tocar em `headers()`
 * — separado justamente para poder ser testado sem simular o runtime do Next.
 *
 * `x-forwarded-for` cresce da ESQUERDA para a direita: o primeiro elemento é o
 * que o cliente mandou — ou seja, o menos confiável — e cada proxy acrescenta ao
 * fim o endereço que ele mesmo observou. Ler o primeiro elemento (como era feito
 * antes) entrega ao atacante o controle da chave de rate limit: variando o
 * cabeçalho, cada tentativa de login virava uma janela nova e o limite de
 * 5/15min nunca disparava. Também envenenava a trilha de auditoria, que é
 * exatamente a fonte usada para investigar um incidente.
 *
 * Por isso: `x-real-ip` primeiro (escrito pelo proxy, nunca pelo cliente) e, na
 * falta dele, o hop confiável contado a partir da DIREITA.
 */
export function resolveClientIp(
  xRealIp: string | null,
  xForwardedFor: string | null,
  trustedHops: number = hopsConfiaveis(),
): string | null {
  const real = xRealIp?.trim();
  if (real) return real;

  const cadeia = (xForwardedFor ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (cadeia.length === 0) return null;

  // Ex.: ["forjado", "cliente-real", "proxy-interno"] com trustedHops=1 → "proxy-interno".
  // Nunca cai abaixo de 0, então uma cadeia mais curta que trustedHops devolve o
  // elemento mais à esquerda em vez de `undefined`.
  return cadeia[Math.max(0, cadeia.length - trustedHops)] ?? null;
}

/** IP do cliente a partir dos headers (para auditoria e rate limit). */
export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return resolveClientIp(h.get("x-real-ip"), h.get("x-forwarded-for"));
}

export async function userAgent(): Promise<string | null> {
  const h = await headers();
  return h.get("user-agent");
}
