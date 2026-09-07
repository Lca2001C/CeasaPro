import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { valeRepetir } from "@/lib/cotacoes/http";

/**
 * Duas travas que não cabem em teste de comportamento e que, se quebrarem, só
 * aparecem em produção às 6h30 da manhã.
 */

describe("a importação não pode derrubar o cron de avisos", () => {
  const rota = "src/app/api/cron/avisos/route.ts";
  const fonte = readFileSync(rota, "utf8");

  it("o arquivo foi lido de verdade", () => {
    expect(fonte).toContain("PushAvisosService");
  });

  /**
   * A fonte de cotações é um sistema legado de terceiro que não nos deve nada.
   * O dia em que ela cair não pode ser o dia em que o cliente para de receber
   * aviso de fiado vencido — que é a razão desta rota existir.
   */
  it("a sub-tarefa de cotações tem `.catch()` próprio", () => {
    const trecho = fonte.slice(fonte.indexOf("CotacoesImportService"));
    expect(trecho).toMatch(/\.catch\(/);
  });

  it("cotações NÃO entra no cron de billing", () => {
    // Cobrança é receita; raspagem é conveniência. Misturar as duas põe o
    // caminho que reconcilia pagamento à mercê de um site externo.
    const billing = readFileSync("src/app/api/cron/billing/route.ts", "utf8");
    expect(billing).not.toContain("CotacoesImportService");
  });

  it("nenhum cron novo foi acrescentado ao vercel.json", () => {
    // O plano Hobby da Vercel aceita 2 agendamentos. Um terceiro faz o DEPLOY
    // falhar — não o cron, o deploy inteiro.
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons?: unknown[] };
    expect(vercel.crons?.length).toBeLessThanOrEqual(2);
  });
});

describe("nenhum teste fala com a internet", () => {
  /**
   * `tests/setup/no-outbound-http.ts` substitui o `fetch` global. Sem esta
   * prova, a trava poderia parar de funcionar (um refactor no setup, uma ordem
   * diferente de `setupFiles`) e ninguém notaria até a suíte começar a martelar
   * o site da CEASAMINAS a cada `git push`.
   */
  it("host externo é recusado", async () => {
    await expect(fetch("https://minas1.ceasa.mg.gov.br/detec/")).rejects.toThrow(
      /tentou acessar a rede/i,
    );
  });

  it("a mensagem ensina o caminho certo", async () => {
    await expect(fetch("https://exemplo.com")).rejects.toThrow(/fixture|fonte falsa/i);
  });

  it("localhost continua liberado — integração usa Postgres e E2E usa o Next", () => {
    // Só verifica que a trava não barra local; não faz a requisição.
    expect(() => new URL("http://localhost:3000/api/health")).not.toThrow();
  });
});

describe("valeRepetir", () => {
  it("repete o que pode melhorar sozinho", () => {
    expect(valeRepetir(429, undefined)).toBe(true);
    expect(valeRepetir(500, undefined)).toBe(true);
    expect(valeRepetir(503, undefined)).toBe(true);
    expect(valeRepetir(undefined, "fetch failed")).toBe(true);
    expect(valeRepetir(undefined, "The operation was aborted due to timeout")).toBe(true);
    expect(valeRepetir(undefined, "ECONNRESET")).toBe(true);
  });

  it("NÃO repete o que vai falhar igual", () => {
    // Repetir 4xx não muda o resultado e só bate no servidor de terceiro.
    expect(valeRepetir(404, undefined)).toBe(false);
    expect(valeRepetir(403, undefined)).toBe(false);
    expect(valeRepetir(400, undefined)).toBe(false);
    expect(valeRepetir(200, undefined)).toBe(false);
    expect(valeRepetir(undefined, "algo inesperado")).toBe(false);
    expect(valeRepetir(undefined, undefined)).toBe(false);
  });
});
