import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { valeRepetir } from "@/lib/cotacoes/http";

/**
 * Duas travas que não cabem em teste de comportamento e que, se quebrarem, só
 * aparecem em produção às 6h30 da manhã.
 */

describe("a importação não pode derrubar o que ela pegou carona", () => {
  const billing = readFileSync("src/app/api/cron/billing/route.ts", "utf8");
  const avisos = readFileSync("src/app/api/cron/avisos/route.ts", "utf8");

  it("os arquivos foram lidos de verdade", () => {
    expect(billing).toContain("BillingService");
    expect(avisos).toContain("PushAvisosService");
  });

  /*
    A importação MUDOU DE CARONA: saiu do cron de avisos (06:30 BRT) para o de
    billing (13:30 BRT). O motivo é o horário — às 6h30 a praça ainda não
    publicou o boletim do dia, então o recuo de datas trazia sempre o de ontem e
    o preço de hoje só aparecia na manhã seguinte. O plano Hobby limita a dois
    agendamentos, então não havia um terceiro horário a pedir.

    A regra que separava as rotas ("cobrança é receita, raspagem é
    conveniência") não foi abandonada: virou POSIÇÃO e ORÇAMENTO, que é o que os
    testes abaixo guardam.
  */
  it("a importação roda no cron de billing", () => {
    expect(billing).toContain("CotacoesImportService");
  });

  it("e NÃO roda mais no de avisos — senão importaria duas vezes por dia", () => {
    expect(avisos).not.toContain("CotacoesImportService");
  });

  /**
   * A fonte de cotações é um sistema legado de terceiro que não nos deve nada.
   * O dia em que ela cair não pode ser o dia em que a assinatura de alguém deixa
   * de ser reconciliada.
   */
  it("a sub-tarefa de cotações tem `.catch()` próprio", () => {
    const trecho = billing.slice(billing.indexOf("CotacoesImportService"));
    expect(trecho).toMatch(/\.catch\(/);
  });

  it("a importação vem DEPOIS de tudo que mexe com dinheiro", () => {
    // Se ela subisse na ordem, um site externo lento passaria a decidir se a
    // reconciliação do dia acontece. Rodando por último, o pior caso é a
    // plataforma matar a função com tudo que é receita já commitado.
    const raspagem = billing.indexOf("CotacoesImportService.importarTodasAsCentrais");
    expect(raspagem).toBeGreaterThan(billing.indexOf("reconcilePendingPayments()"));
    expect(raspagem).toBeGreaterThan(billing.indexOf("recomputeStatuses()"));
    expect(raspagem).toBeGreaterThan(billing.indexOf("enviarLembretesDeVencimento()"));
  });

  it("a rota declara maxDuration e passa orçamento ao serviço", () => {
    // Sem `maxDuration` a função morre em ~10 s no Hobby, no meio de uma
    // gravação. Sem orçamento calculado, o serviço usaria os 40 s dele sem saber
    // quanto o billing já gastou, e a soma passaria do teto.
    expect(billing).toMatch(/export const maxDuration = 60/);
    expect(billing).toMatch(/orcamentoMs:/);
  });

  it("nenhum cron novo foi acrescentado ao vercel.json", () => {
    // O plano Hobby da Vercel aceita 2 agendamentos. Um terceiro faz o DEPLOY
    // falhar — não o cron, o deploy inteiro.
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons?: unknown[] };
    expect(vercel.crons?.length).toBeLessThanOrEqual(2);
  });

  it("o cron que importa roda de TARDE no horário do Brasil", () => {
    /*
      Este é o teste que guarda a razão da mudança, e ele é chato de propósito.

      A Vercel agenda em UTC. O boletim do dia só existe depois que a praça
      publica, e de manhã cedo ela não publicou: um cron de madrugada busca e
      encontra o de ontem, todo dia, sem erro nenhum aparecer. Alguém que mova
      este horário de volta para as 6h não quebra teste de comportamento nenhum —
      só faz o módulo voltar a entregar o preço um dia atrasado, em silêncio.
    */
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons?: { path: string; schedule: string }[];
    };
    const importador = vercel.crons?.find((c) => c.path === "/api/cron/billing");
    expect(importador).toBeDefined();
    const hora = Number(importador!.schedule.split(" ")[1]);
    // 15 UTC = 12:00 BRT. Antes disso não há boletim do dia a buscar.
    expect(hora).toBeGreaterThanOrEqual(15);
    expect(hora).toBeLessThanOrEqual(23);
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
