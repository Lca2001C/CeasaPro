import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * O `CRON_SECRET` — o único autenticador do sistema que não tinha teste nenhum.
 *
 * As duas rotas de cron (`/api/cron/billing` e `/api/cron/avisos`) estão em
 * `PUBLIC_PREFIXES` do proxy: o Vercel Cron chega sem cookie, então o porteiro
 * de sessão não pode barrá-las. **Toda a autenticação delas é a função
 * `authorized()` de dentro do próprio handler.**
 *
 * O que elas fazem se alguém entrar: reconciliar cobrança no Mercado Pago,
 * recalcular status de assinatura de todas as empresas, disparar e-mail de
 * vencimento, gerar despesas recorrentes, mandar push para toda a base e
 * raspar sites de terceiros. Uma requisição repetida em laço é negação de
 * serviço barata contra a plataforma e contra a fonte externa.
 *
 * Os outros três autenticadores já tinham cobertura — JWT
 * (`jwt-claims.test.ts`), HMAC do webhook (`mp-webhook-signature.test.ts`) e
 * rate limit (`rate-limit-db.test.ts`). Este era o que faltava.
 *
 * A verificação existe duplicada nos dois arquivos, então os dois são testados:
 * corrigir um e esquecer o outro é o desfecho normal de código copiado.
 */

vi.mock("@/lib/services/billing.service", () => ({
  BillingService: {
    reconcilePendingPayments: vi.fn().mockResolvedValue({ conferidas: 0 }),
    recomputeStatuses: vi.fn().mockResolvedValue({ atualizadas: 0 }),
    enviarLembretesDeVencimento: vi.fn().mockResolvedValue({ enviados: 0 }),
  },
}));
vi.mock("@/lib/services/despesas.service", () => ({
  gerarRecorrentesDeTodosOsTenants: vi.fn().mockResolvedValue({ criadas: 0 }),
}));
vi.mock("@/lib/services/cotacoes-import.service", () => ({
  CotacoesImportService: {
    importarTodasAsCentrais: vi.fn().mockResolvedValue({ centrais: 0 }),
    verificarDefasagem: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock("@/lib/services/push-avisos.service", () => ({
  PushAvisosService: {
    enviarAvisosDiarios: vi.fn().mockResolvedValue({ candidatos: 0, enviados: 0 }),
  },
}));
vi.mock("@/lib/security/rate-limit-db", () => ({
  purgeExpiredRateLimits: vi.fn().mockResolvedValue(0),
}));
vi.mock("@/lib/auth/refresh", () => ({
  purgeDeadRefreshTokens: vi.fn().mockResolvedValue(0),
}));

const billing = await import("@/app/api/cron/billing/route");
const avisos = await import("@/app/api/cron/avisos/route");

const ROTAS = [
  { nome: "cron/billing", handler: billing.GET },
  { nome: "cron/avisos", handler: avisos.GET },
] as const;

const SEGREDO = "segredo-do-cron-1234567890";
const pedido = (auth?: string) =>
  new Request("http://localhost/api/cron/x", {
    headers: auth === undefined ? {} : { authorization: auth },
  });

let original: string | undefined;

beforeEach(() => {
  original = process.env.CRON_SECRET;
  process.env.CRON_SECRET = SEGREDO;
});

afterEach(() => {
  if (original === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = original;
  vi.clearAllMocks();
});

for (const { nome, handler } of ROTAS) {
  describe(`${nome} — quem entra`, () => {
    it("aceita o segredo correto", async () => {
      const r = await handler(pedido(`Bearer ${SEGREDO}`));
      expect(r.status).toBe(200);
    });

    it("recusa sem cabeçalho Authorization", async () => {
      expect((await handler(pedido())).status).toBe(401);
    });

    it("recusa segredo errado do MESMO tamanho", async () => {
      /*
        Mesmo tamanho de propósito: é o caso que passa pela checagem de
        comprimento e chega ao `timingSafeEqual`. Um teste só com string curta
        não exercitaria a comparação de verdade.
      */
      const errado = "x".repeat(SEGREDO.length);
      expect(errado).toHaveLength(SEGREDO.length);
      expect((await handler(pedido(`Bearer ${errado}`))).status).toBe(401);
    });

    it("recusa segredo de tamanho diferente SEM explodir", async () => {
      /*
        `timingSafeEqual` LANÇA quando os buffers têm tamanhos diferentes. É
        por isso que o código compara o comprimento antes. Sem essa guarda, um
        palpite de tamanho errado viraria 500 com stack em vez de 401 — e a
        diferença entre 500 e 401 já entrega ao atacante que o tamanho está
        errado, que é exatamente a informação que a comparação em tempo
        constante existe para não vazar.
      */
      for (const errado of ["Bearer curto", `Bearer ${SEGREDO}${SEGREDO}`]) {
        const r = await handler(pedido(errado));
        expect(r.status, errado).toBe(401);
      }
    });

    it("recusa o segredo sem o prefixo Bearer", async () => {
      expect((await handler(pedido(SEGREDO))).status).toBe(401);
    });

    it("recusa `Bearer` sozinho e cabeçalho vazio", async () => {
      expect((await handler(pedido("Bearer"))).status).toBe(401);
      expect((await handler(pedido(""))).status).toBe(401);
    });

    it("com CRON_SECRET AUSENTE no ambiente, recusa TUDO", async () => {
      /*
        A regra que mais importa: sem segredo configurado a rota fecha, não
        abre. Um deploy que esqueça a variável de ambiente deixaria a rota
        pública — e ela é pública no proxy de propósito, porque o Vercel Cron
        chega sem cookie. É o pior desfecho possível de um esquecimento de
        configuração, e é o que esta asserção impede de voltar.
      */
      delete process.env.CRON_SECRET;

      expect((await handler(pedido(`Bearer ${SEGREDO}`))).status).toBe(401);
      expect((await handler(pedido("Bearer "))).status).toBe(401);
      expect((await handler(pedido())).status).toBe(401);
      /*
        `Bearer undefined` é o caso que realmente importa, e o que a primeira
        versão deste teste deixou passar.

        Sem a guarda `!secret`, `process.env.CRON_SECRET` ausente faz o código
        montar `Buffer.from("Bearer undefined")` — e aí o segredo do sistema
        passa a ser a string literal "undefined", que é a primeira coisa que
        alguém tentaria. Os três casos acima não pegavam isso: eles mandam
        segredos de OUTRO tamanho, e a comparação de comprimento os barra por
        acidente, escondendo o buraco.
      */
      expect((await handler(pedido("Bearer undefined"))).status).toBe(401);
      expect((await handler(pedido("Bearer null"))).status).toBe(401);
    });

    it("com CRON_SECRET vazio, também recusa", async () => {
      // String vazia é falsy e cai no mesmo caminho — fixado para ninguém
      // trocar `!secret` por `secret === undefined` e reabrir a porta.
      process.env.CRON_SECRET = "";
      expect((await handler(pedido("Bearer "))).status).toBe(401);
    });

    it("a recusa não diz por que recusou", async () => {
      // Corpo idêntico para segredo errado e segredo ausente: qualquer
      // diferença é um oráculo para quem está tentando adivinhar.
      const semSegredo = await handler(pedido("Bearer errado-errado-errado-x"));
      delete process.env.CRON_SECRET;
      const semVariavel = await handler(pedido(`Bearer ${SEGREDO}`));

      expect(await semSegredo.text()).toBe(await semVariavel.text());
    });
  });
}

describe("as duas rotas usam a MESMA verificação", () => {
  it("nenhuma delas passa por wrapper de sessão — a autenticação é o segredo", async () => {
    /*
      As rotas de cron estão em `PUBLIC_PREFIXES` (`src/proxy.ts`), então não
      há sessão nem gate de módulo no caminho. Se alguém acrescentar um handler
      novo em `/api/cron/*` e esquecer o `authorized()`, ele nasce aberto para
      a internet. Este teste lê o fonte das duas rotas e cobra a chamada.
    */
    const { readFileSync, readdirSync } = await import("node:fs");
    const dirs = readdirSync("src/app/api/cron", { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    expect(dirs.length, "nenhuma rota de cron encontrada").toBeGreaterThan(0);

    const semAuth: string[] = [];
    for (const d of dirs) {
      const fonte = readFileSync(`src/app/api/cron/${d}/route.ts`, "utf8");
      const temFuncao = /function authorized\(/.test(fonte);
      const temChamada = /if \(!authorized\(req\)\)/.test(fonte);
      // A CHAMADA, não o import: trocar o corpo por `a === b` deixaria o
      // import intacto e o guard passaria com a comparação insegura no lugar.
      const temTempoConstante = fonte.includes("return timingSafeEqual(");
      if (!temFuncao || !temChamada || !temTempoConstante) {
        semAuth.push(`${d} (função:${temFuncao} chamada:${temChamada} tempo-constante:${temTempoConstante})`);
      }
    }
    expect(semAuth, "rota de cron sem verificação de CRON_SECRET").toEqual([]);
  });
});
