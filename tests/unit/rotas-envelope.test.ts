import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Toda rota de `src/app/api` passa por envelope — ou declara por que não.
 *
 * Existia um teste que cobra `module:` nas Server Actions
 * (`actions-module-gate.test.ts`) e outro que cobra `requirePagina` nos layouts
 * (`paginas-module-gate.test.ts`). Não existia o equivalente para ROTAS.
 *
 * O buraco que isso deixava: uma rota nova sem `withTenantRoute` nasce sem
 * sessão, sem conferência de assinatura, sem gate de módulo, sem throttle e sem
 * revogação — e passa por lint, tipo, build e por toda a suíte sem acusar nada.
 * O mesmo vale para um handler novo em `/api/cron/*` que esqueça o
 * `CRON_SECRET`: essas rotas são públicas no proxy de propósito, porque o
 * Vercel Cron chega sem cookie.
 *
 * Lê o fonte porque é omissão de cadastro — não há como perguntar em runtime a
 * um módulo de rota se ele está protegido. É a mesma estratégia dos dois testes
 * irmãos.
 */

const RAIZ = "src/app/api";

/** Toda `route.ts` sob `src/app/api`, recursivamente. */
function rotas(dir = RAIZ): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const caminho = join(dir, e.name).split("\\").join("/");
    if (e.isDirectory()) return rotas(caminho);
    return e.name === "route.ts" ? [caminho] : [];
  });
}

/**
 * Rotas que NÃO usam envelope, cada uma com o motivo.
 *
 * Allowlist com justificativa escrita, no molde do `PLATAFORMA` de
 * `models-tenant-cobertura.test.ts`. Acrescentar uma entrada aqui é uma
 * decisão consciente de deixar uma rota fora da barreira padrão — e fica
 * registrada para a próxima pessoa discutir, em vez de descobrir por acaso.
 */
const SEM_ENVELOPE: Record<string, string> = {
  // Autenticação: por definição acontece ANTES de haver sessão, então não há
  // o que o envelope de tenant pudesse conferir. Cada uma tem rate limit
  // próprio no Postgres (`rate-limit-db.ts`).
  "src/app/api/auth/login/route.ts": "pré-sessão; rate limit por IP+e-mail",
  "src/app/api/auth/logout/route.ts": "pré-sessão; encerra o que existir",
  "src/app/api/auth/refresh/route.ts": "autenticada pelo refresh token, não pelo access",
  "src/app/api/auth/renovar/route.ts": "idem, e exige Fetch Metadata de navegação",
  "src/app/api/auth/signup/route.ts": "cadastro público; rate limit por IP+e-mail",
  "src/app/api/auth/forgot/route.ts": "pré-sessão; rate limit próprio",
  "src/app/api/auth/reset/route.ts": "autenticada pelo token do e-mail",
  "src/app/api/auth/change-password/route.ts":
    "faz a própria sessão e o próprio rate limit; precisa rodar com mustChangePassword ativo, que o envelope barra",
  "src/app/api/auth/google/route.ts": "início do OAuth; pré-sessão",
  "src/app/api/auth/google/callback/route.ts": "retorno do OAuth; autenticado pelo state assinado",

  // Chamadores externos, autenticados por segredo compartilhado.
  "src/app/api/webhooks/mercadopago/route.ts": "autenticada por HMAC (verifyWebhookSignature)",
  "src/app/api/cron/billing/route.ts": "autenticada por CRON_SECRET em tempo constante",
  "src/app/api/cron/avisos/route.ts": "autenticada por CRON_SECRET em tempo constante",

  // Sonda de infraestrutura: não toca o banco de propósito.
  "src/app/api/health/route.ts": "sonda pública; não lê dado de ninguém",
};

const ENVELOPES = ["withTenantRoute", "withAdminRoute"];

describe("envelope nas rotas de API", () => {
  it("o diretório foi lido de verdade", () => {
    // Se a varredura parar de achar arquivo, o teste tem de falhar em vez de
    // passar vazio.
    expect(rotas().length).toBeGreaterThan(15);
  });

  it("toda rota usa envelope ou está declarada como exceção", () => {
    const desprotegidas = rotas().filter((r) => {
      if (r in SEM_ENVELOPE) return false;
      const fonte = readFileSync(r, "utf8");
      return !ENVELOPES.some((e) => fonte.includes(e));
    });

    expect(
      desprotegidas,
      "rota sem envelope e sem justificativa: nasce sem sessão, sem assinatura, " +
        "sem gate de módulo e sem throttle",
    ).toEqual([]);
  });

  it("nenhuma exceção declarada virou fantasma", () => {
    // Renomear ou apagar uma rota sem limpar a lista deixaria a allowlist
    // protegendo um arquivo que não existe — e escondendo que ela cresceu.
    const existentes = new Set(rotas());
    const fantasmas = Object.keys(SEM_ENVELOPE).filter((r) => !existentes.has(r));
    expect(fantasmas, "exceção declarada para rota inexistente").toEqual([]);
  });

  it("nenhuma exceção usa envelope (a lista seria mentira)", () => {
    const contraditorias = Object.keys(SEM_ENVELOPE).filter((r) => {
      const fonte = readFileSync(r, "utf8");
      return ENVELOPES.some((e) => fonte.includes(e));
    });
    expect(contraditorias, "rota na lista de exceção que na verdade tem envelope").toEqual([]);
  });

  it("toda exceção tem motivo escrito", () => {
    const semMotivo = Object.entries(SEM_ENVELOPE)
      .filter(([, motivo]) => motivo.trim().length < 15)
      .map(([r]) => r);
    expect(semMotivo, "exceção sem justificativa legível").toEqual([]);
  });
});

describe("as rotas de exceção têm autenticação PRÓPRIA", () => {
  /*
    Estar fora do envelope não pode significar estar aberta. Cada família de
    exceção precisa carregar a sua própria porta, e é isso que se cobra aqui —
    senão a allowlist acima vira o lugar onde o próximo furo se esconde.
  */
  it("cron: CRON_SECRET comparado em tempo constante", () => {
    for (const r of rotas().filter((x) => x.includes("/api/cron/"))) {
      const fonte = readFileSync(r, "utf8");
      expect(fonte, `${r} sem CRON_SECRET`).toContain("process.env.CRON_SECRET");
      expect(fonte, `${r} sem comparação em tempo constante`).toContain(
        "return timingSafeEqual(",
      );
      expect(fonte, `${r} não chama authorized()`).toMatch(/if \(!authorized\(req\)\)/);
    }
  });

  it("webhook: verificação de assinatura antes de processar", () => {
    const fonte = readFileSync("src/app/api/webhooks/mercadopago/route.ts", "utf8");
    expect(fonte).toContain("verifyWebhookSignature");
    // O 401 tem de vir antes do `after(` que agenda o processamento.
    expect(fonte.indexOf("status: 401")).toBeLessThan(fonte.indexOf("after(async"));
  });

  it("auth: as rotas de entrada têm rate limit", () => {
    /*
      Login, cadastro, recuperação e reset são as portas que um atacante bate
      em laço. `logout`, `refresh`, `renovar` e o callback do Google ficam de
      fora: os três primeiros são autenticados por token próprio e o callback
      pelo state assinado — limitar ali derrubaria sessão legítima.
    */
    const comLimite = [
      "src/app/api/auth/login/route.ts",
      "src/app/api/auth/signup/route.ts",
      "src/app/api/auth/forgot/route.ts",
      "src/app/api/auth/reset/route.ts",
      "src/app/api/auth/change-password/route.ts",
      "src/app/api/auth/google/route.ts",
    ];
    const semLimite = comLimite.filter((r) => !readFileSync(r, "utf8").includes("rateLimitDb"));
    expect(semLimite, "rota de autenticação sem rate limit persistente").toEqual([]);
  });
});
