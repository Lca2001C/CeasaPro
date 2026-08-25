/**
 * Rate limit em memória (janela deslizante), best-effort e **por instância**.
 *
 * Uso pretendido: o throttle por empresa de `with-route.ts`, que existe para
 * conter abuso acidental (loop de UI, cliente repetindo request) — ali um
 * contador local basta e evita uma ida ao banco a cada requisição.
 *
 * NÃO use isto no que precisa resistir a ataque. Em serverless cada request pode
 * cair numa instância diferente, então este contador não segura força bruta: as
 * rotas de autenticação usam `rate-limit-db.ts`, que persiste no Postgres.
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return { ok: true, retryAfterMs: 0 };
  }
  if (b.count >= opts.limit) {
    return { ok: false, retryAfterMs: b.resetAt - now };
  }
  b.count += 1;
  return { ok: true, retryAfterMs: 0 };
}
