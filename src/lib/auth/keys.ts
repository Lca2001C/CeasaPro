/**
 * Chaves de assinatura DERIVADAS, uma por propósito.
 *
 * Havia um furo de confusão de tipo de token: `accessSecret()` (em `jwt.ts`) e
 * `oauthSecret()` (em `google-oauth.ts`) liam a MESMA `JWT_SECRET` e produziam
 * a mesma chave HS256. Nenhum dos dois tokens carregava `iss`, `aud` ou um
 * claim de tipo, e `verifyAccess` chamava `jwtVerify` sem restringir nada.
 *
 * Resultado: o JWT de state do OAuth era aceito como access token. E não é um
 * token difícil de obter — basta abrir `/api/auth/google` e ler o próprio
 * cookie `cp_google_oauth` no devtools (httpOnly não protege contra o dono da
 * máquina). A sessão forjada saía com `role: undefined` e `tenantId: null`,
 * passava pelo `if (!session)` do proxy, pelo gate de assinatura
 * (`accessDecision(null, null)` devolve "ok") e pelo de módulo. Só era barrada
 * depois, pela checagem redundante de `tenantId` em `(app)/layout.tsx` e em
 * `requireTenant` — ou seja, o sistema não caiu por sorte de projeto, e sim
 * porque havia uma segunda trava por outro motivo.
 *
 * HKDF a partir de `JWT_SECRET`, com rótulo por propósito: nenhuma variável de
 * ambiente nova, nenhuma migration, e as duas chaves passam a ser
 * criptograficamente independentes.
 *
 * Edge-safe de propósito: só WebCrypto, sem `node:crypto` e sem `server-only`.
 * O proxy roda no Edge e importa `jwt.ts`.
 */

const textoParaBytes = new TextEncoder();

/** Uma derivação por isolate, não por token. */
const cache = new Map<string, Promise<Uint8Array>>();

/** Rótulos HKDF. Trocar um rótulo invalida os tokens daquele propósito. */
export const CHAVE_ACCESS = "cp:access:v1";
export const CHAVE_OAUTH_STATE = "cp:oauth-state:v1";

async function derivar(info: string): Promise<Uint8Array> {
  const segredo = process.env.JWT_SECRET;
  if (!segredo) throw new Error("JWT_SECRET não configurado");

  const base = await crypto.subtle.importKey(
    "raw",
    textoParaBytes.encode(segredo),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: textoParaBytes.encode(info),
    },
    base,
    256,
  );
  return new Uint8Array(bits);
}

/** Chave HS256 do propósito pedido, derivada de `JWT_SECRET`. */
export function chaveDerivada(info: string): Promise<Uint8Array> {
  let derivada = cache.get(info);
  if (!derivada) {
    derivada = derivar(info);
    cache.set(info, derivada);
  }
  return derivada;
}
