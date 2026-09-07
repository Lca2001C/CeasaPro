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
 * `x-real-ip` NÃO tem precedência, e essa ordem é a correção de um furo: ele era
 * lido primeiro e sem condição nenhuma, com a justificativa de que "é escrito
 * pelo proxy, nunca pelo cliente". Isso é uma suposição de implantação, não uma
 * verificação. Fora da Vercel — o `docker-compose.yml` deste repositório, um
 * `npm start` atrás de um Nginx sem `proxy_set_header X-Real-IP`, ou a porta
 * exposta direto — o atacante manda `X-Real-IP: <aleatório>` a cada tentativa e
 * anula justamente o que este arquivo existe para proteger: a janela de 5
 * logins/15min, o limite de recuperação de senha, o de cadastro, e o `ip` da
 * trilha de auditoria.
 *
 * A inversão é segura porque todo proxy que escreve `x-real-ip` também
 * acrescenta ao `x-forwarded-for` — Vercel manda os dois, Nginx com
 * `X-Real-IP` também põe `X-Forwarded-For`. Então `x-real-ip` só é alcançado
 * quando NÃO há cadeia nenhuma, ou seja, quando não há proxy à frente: aí
 * forjá-lo não dá nada que forjar o `x-forwarded-for` já não desse.
 */
export function resolveClientIp(
  xRealIp: string | null,
  xForwardedFor: string | null,
  trustedHops: number = hopsConfiaveis(),
): string | null {
  const cadeia = (xForwardedFor ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (cadeia.length === 0) return xRealIp?.trim() || null;

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
