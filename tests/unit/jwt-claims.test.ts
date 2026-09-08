import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import { signAccess, verifyAccess, EMISSOR, PUBLICO_ACCESS } from "@/lib/auth/jwt";
import { assinarEstadoOAuth, lerEstadoOAuth } from "@/lib/auth/google-oauth";
import { chaveDerivada, CHAVE_ACCESS, CHAVE_OAUTH_STATE } from "@/lib/auth/keys";

/**
 * Confusão de tipo de token.
 *
 * `accessSecret()` e `oauthSecret()` liam a MESMA `JWT_SECRET` e produziam a
 * mesma chave HS256. Nenhum dos dois tokens carregava `iss`, `aud` ou tipo, e
 * `verifyAccess` chamava `jwtVerify` sem restringir nada — então o JWT de state
 * do OAuth era aceito como access token.
 *
 * E o state não é difícil de obter: basta abrir `/api/auth/google` e ler o
 * próprio cookie `cp_google_oauth` no devtools (httpOnly não protege contra o
 * dono da máquina). A sessão forjada saía com `role: undefined` e
 * `tenantId: null`, passava pelo `if (!session)` do proxy, pelo gate de
 * assinatura (`accessDecision(null, null)` devolve "ok") e pelo de módulo — e
 * só era barrada depois, pela checagem redundante de `tenantId`.
 */

const PAYLOAD = {
  sub: "user-1",
  role: "OWNER" as const,
  tenantId: "tenant-1",
  email: "dono@exemplo.com",
  name: "Dono",
  mustChangePassword: false,
  tenantStatus: "ACTIVE" as const,
  subStatus: "ATIVO" as const,
  modules: ["caixas"],
};

const ESTADO = { state: "abc", verifier: "xyz", next: "/dashboard" };

describe("um token não vale pelo outro", () => {
  it("o state do OAuth NÃO é aceito como sessão", async () => {
    const state = await assinarEstadoOAuth(ESTADO);
    expect(await verifyAccess(state)).toBeNull();
  });

  it("o access token NÃO é aceito como state do OAuth", async () => {
    const access = await signAccess(PAYLOAD);
    expect(await lerEstadoOAuth(access)).toBeNull();
  });

  it("as duas chaves derivadas são diferentes", async () => {
    const a = await chaveDerivada(CHAVE_ACCESS);
    const b = await chaveDerivada(CHAVE_OAUTH_STATE);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});

describe("token assinado fora do contrato é recusado", () => {
  const cru = () => new TextEncoder().encode(process.env.JWT_SECRET!);

  it("assinado com a JWT_SECRET crua (esquema antigo) não vale", async () => {
    const antigo = await new SignJWT({ ...PAYLOAD })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(cru());
    expect(await verifyAccess(antigo)).toBeNull();
  });

  it("público errado não vale", async () => {
    const errado = await new SignJWT({ ...PAYLOAD, typ: "access" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(PAYLOAD.sub)
      .setIssuer(EMISSOR)
      .setAudience("outro-app")
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(await chaveDerivada(CHAVE_ACCESS));
    expect(await verifyAccess(errado)).toBeNull();
  });

  it("tipo errado não vale, mesmo com chave, emissor e público certos", async () => {
    const errado = await new SignJWT({ ...PAYLOAD, typ: "oauth-state" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(PAYLOAD.sub)
      .setIssuer(EMISSOR)
      .setAudience(PUBLICO_ACCESS)
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(await chaveDerivada(CHAVE_ACCESS));
    expect(await verifyAccess(errado)).toBeNull();
  });

  it("sem `typ` não vale — requiredClaims cobre o token cortado pela metade", async () => {
    const semTipo = await new SignJWT({ ...PAYLOAD })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(PAYLOAD.sub)
      .setIssuer(EMISSOR)
      .setAudience(PUBLICO_ACCESS)
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(await chaveDerivada(CHAVE_ACCESS));
    expect(await verifyAccess(semTipo)).toBeNull();
  });
});

describe("o caminho feliz continua inteiro", () => {
  it("ida e volta preserva o payload", async () => {
    const lido = await verifyAccess(await signAccess(PAYLOAD));
    expect(lido).toMatchObject({
      sub: PAYLOAD.sub,
      role: PAYLOAD.role,
      tenantId: PAYLOAD.tenantId,
      email: PAYLOAD.email,
      name: PAYLOAD.name,
      mustChangePassword: false,
      modules: ["caixas"],
    });
  });

  it("o state do OAuth continua legível por quem deve", async () => {
    const lido = await lerEstadoOAuth(await assinarEstadoOAuth(ESTADO));
    expect(lido).toEqual(ESTADO);
  });
});
