import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/db/prisma";
import { NoticiasService } from "@/lib/services/noticias.service";
import { AdminNotificationsService } from "@/lib/services/admin-notifications.service";
import { FEEDS } from "@/lib/noticias/fontes";

/**
 * Coleta do CeasaNews contra feeds REAIS em fixture. O `fetch` é trocado por um
 * que responde conforme a URL — a rede de verdade nunca é tocada.
 *
 * As tabelas são globais (sem tenant): cada teste começa com elas vazias.
 */

const fixture = (nome: string) => readFileSync(`tests/fixtures/noticias/${nome}.xml`, "utf8");
const AGORA = new Date("2026-10-17T03:00:00Z");

function servir(porChave: Record<string, string | number>) {
  vi.stubGlobal("fetch", async (url: RequestInfo | URL) => {
    const feed = FEEDS.find((f) => f.url === String(url));
    const r = feed ? porChave[feed.chave] : undefined;
    if (r === undefined || typeof r === "number") return new Response("erro", { status: r ?? 404 });
    return new Response(r, { status: 200, headers: { "Content-Type": "application/rss+xml" } });
  });
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  await prisma.noticia.deleteMany({});
  await prisma.noticiaColeta.deleteMany({});
  await prisma.adminNotification.deleteMany({ where: { kind: "NOTICIAS_FALHA" } });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma.noticia.deleteMany({});
  await prisma.noticiaColeta.deleteMany({});
  await prisma.adminNotification.deleteMany({ where: { kind: "NOTICIAS_FALHA" } });
});

describe("NoticiasService.coletar", () => {
  it("grava só o que passa no filtro, e registra cada feed", async () => {
    servir({ "g1-agro": fixture("g1-agro"), "gn-ceasa": fixture("googlenews"), canalrural: 503 });
    const r = await NoticiasService.coletar({ agora: AGORA });

    expect(r.feeds).toBe(FEEDS.length);
    expect(r.novas).toBeGreaterThan(0);
    const g1 = await prisma.noticiaColeta.findFirstOrThrow({ where: { feed: "g1-agro" } });
    expect(g1.status).toBe("OK");
    expect(g1.aceitos).toBeLessThan(g1.lidos);
    const canal = await prisma.noticiaColeta.findFirstOrThrow({ where: { feed: "canalrural" } });
    expect(canal.status).toBe("FALHA");
    expect(canal.httpStatus).toBe(503);
    // Um feed fora do ar não alarma: as outras fontes cobrem.
    const avisos = await AdminNotificationsService.listar();
    expect(avisos.filter((a) => a.kind === "NOTICIAS_FALHA")).toHaveLength(0);
  });

  it("a mesma matéria chegando por dois feeds fica UMA vez", async () => {
    // Duas buscas do Google Notícias devolvendo os mesmos itens.
    servir({ "gn-ceasa": fixture("googlenews"), "gn-hortifruti": fixture("googlenews") });
    await NoticiasService.coletar({ agora: AGORA });
    const urls = await prisma.noticia.findMany({ select: { url: true } });
    expect(new Set(urls.map((u) => u.url)).size).toBe(urls.length);
    const [a, b] = await Promise.all([
      prisma.noticiaColeta.findFirstOrThrow({ where: { feed: "gn-ceasa" } }),
      prisma.noticiaColeta.findFirstOrThrow({ where: { feed: "gn-hortifruti" } }),
    ]);
    expect(a.novos + b.novos).toBe(urls.length);
  });

  it("recoletar não duplica nada", async () => {
    servir({ "gn-ceasa": fixture("googlenews") });
    await NoticiasService.coletar({ agora: AGORA });
    const antes = await prisma.noticia.count();
    const r = await NoticiasService.coletar({ agora: AGORA });
    expect(await prisma.noticia.count()).toBe(antes);
    expect(r.novas).toBe(0);
  });

  it("TODOS os feeds fora avisa o super-admin", async () => {
    servir({});
    const r = await NoticiasService.coletar({ agora: AGORA });
    expect(r.falhas).toBe(FEEDS.length);
    const avisos = await AdminNotificationsService.listar();
    expect(avisos.some((a) => a.kind === "NOTICIAS_FALHA")).toBe(true);
  });

  it("notícia com mais de 30 dias não entra, e a velha guardada é apagada", async () => {
    await prisma.noticia.create({
      data: {
        url: "https://velha.com/x",
        chaveTitulo: "velha",
        fonte: "X",
        feed: "gn-ceasa",
        titulo: "Velha",
        publicadaEm: new Date("2026-08-01T00:00:00Z"),
      },
    });
    servir({});
    await NoticiasService.coletar({ agora: AGORA });
    expect(await prisma.noticia.count({ where: { url: "https://velha.com/x" } })).toBe(0);
  });
});

describe("NoticiasService.listar", () => {
  it("últimos 7 dias, mais nova primeiro, e filtra por tema", async () => {
    servir({ "gn-ceasa": fixture("googlenews"), "g1-agro": fixture("g1-agro") });
    await NoticiasService.coletar({ agora: AGORA });
    const todas = await NoticiasService.listar({ agora: AGORA });
    expect(todas.length).toBeGreaterThan(0);
    for (let i = 1; i < todas.length; i++) {
      expect(todas[i - 1]!.publicadaEm.getTime()).toBeGreaterThanOrEqual(todas[i]!.publicadaEm.getTime());
    }
    const ceasa = await NoticiasService.listar({ agora: AGORA, tema: "CEASA" });
    expect(ceasa.length).toBeGreaterThan(0);
    expect(ceasa.every((n) => n.temas.includes("CEASA"))).toBe(true);
  });

  it("primeira coleta falhando: não repete a cada abertura da tela nem repete o aviso", async () => {
    // Feeds fora: sem nenhuma coleta boa, a tela tentava de novo a cada
    // acesso (até 20 s de espera) e criava um NOTICIAS_FALHA por acesso.
    servir({});
    await prisma.rateLimit.deleteMany({ where: { keyHash: "ceasanews:coleta" } });
    expect(await NoticiasService.primeiraColetaSeNunca()).toBe(true);
    expect(await NoticiasService.primeiraColetaSeNunca()).toBe(false);
    expect(await prisma.noticiaColeta.count({ where: { feed: "gn-ceasa" } })).toBe(1);

    await NoticiasService.coletar({ agora: AGORA });
    const avisos = await prisma.adminNotification.count({ where: { kind: "NOTICIAS_FALHA" } });
    expect(avisos).toBe(1);
  });

  it("coletarSeVelho não coleta de novo dentro de 2 h", async () => {
    servir({ "gn-ceasa": fixture("googlenews") });
    await NoticiasService.coletar({ agora: AGORA });
    const r = await NoticiasService.coletarSeVelho(new Date());
    expect(r).toBeNull();
  });
});
