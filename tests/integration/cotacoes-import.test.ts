import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { CotacoesImportService } from "@/lib/services/cotacoes-import.service";
import { lerCsvDeCotacoes } from "@/lib/cotacoes/csv";
import { parseFormDateTz } from "@/lib/tz";

/**
 * Gravação de boletim.
 *
 * O que estes testes protegem é a IDEMPOTÊNCIA: importar o mesmo dia de novo
 * tem de corrigir, nunca duplicar. Sem isso, um boletim reimportado por engano
 * (ou um cron que rodou duas vezes) faria o mesmo produto aparecer várias vezes
 * na tela do cliente, com preços possivelmente diferentes, e não haveria como
 * saber qual estava valendo.
 */

const uniq = () => Math.random().toString(36).slice(2, 10);
const CENTRAL = `IMP${uniq().slice(0, 5)}`.toUpperCase();
const slugsCriados: string[] = [];

const BOLETIM = [
  "TOMATE SALADA;CX 20KG;80,00;85,00;92,00",
  "BATATA LISA;SC 50KG;110,00;118,00;125,00",
].join("\n");

async function importar(texto: string, data: string, sourceKey = "manual") {
  const { linhas } = lerCsvDeCotacoes(texto);
  return CotacoesImportService.gravar({
    centralCode: CENTRAL,
    quoteDate: parseFormDateTz(data),
    linhas,
    sourceKey,
  });
}

beforeAll(async () => {
  await prisma.ceasaCentral.create({
    data: {
      code: CENTRAL,
      name: "Central de Importacao",
      city: "Contagem",
      uf: "MG",
      sourceKey: "manual",
    },
  });
});

afterAll(async () => {
  await prisma.ceasaQuote.deleteMany({ where: { centralCode: CENTRAL } });
  await prisma.ceasaImportRun.deleteMany({ where: { centralCode: CENTRAL } });
  await prisma.ceasaCentral.deleteMany({ where: { code: CENTRAL } });
  // Os produtos são globais e não caem por cascata da central.
  await prisma.ceasaProduct.deleteMany({ where: { slug: { in: slugsCriados } } });
});

describe("CotacoesImportService.gravar", () => {
  it("grava o boletim e registra a execução", async () => {
    const r = await importar(BOLETIM, "2026-09-10");
    slugsCriados.push("tomate-salada", "batata-lisa");

    expect(r.cotacoesGravadas).toBe(2);

    const run = await prisma.ceasaImportRun.findUniqueOrThrow({ where: { id: r.runId } });
    expect(run.status).toBe("OK");
    expect(run.rowsUpserted).toBe(2);
    expect(run.sourceKey).toBe("manual");
    expect(run.finishedAt).not.toBeNull();
  });

  it("a data gravada é o dia DIGITADO, não o anterior", async () => {
    // `new Date("2026-09-10")` é meia-noite UTC = dia 9 às 21h no Brasil. Sem
    // `parseFormDateTz`, o boletim do dia 10 entraria como dia 9 e a tela
    // mostraria a data errada para todo mundo.
    const q = await prisma.ceasaQuote.findFirst({
      where: { centralCode: CENTRAL },
      select: { quoteDate: true },
    });
    expect(q!.quoteDate.toISOString().slice(0, 10)).toBe("2026-09-10");
  });

  it("reimportar o MESMO dia atualiza em vez de duplicar", async () => {
    const antes = await prisma.ceasaQuote.count({ where: { centralCode: CENTRAL } });

    // Mesmo boletim, preço corrigido.
    await importar("TOMATE SALADA;CX 20KG;80,00;99,00;110,00", "2026-09-10");

    const depois = await prisma.ceasaQuote.count({ where: { centralCode: CENTRAL } });
    expect(depois).toBe(antes);

    const tomate = await prisma.ceasaQuote.findFirstOrThrow({
      where: { centralCode: CENTRAL, product: { slug: "tomate-salada" } },
    });
    expect(Number(tomate.refPrice)).toBe(99);
  });

  it("o mesmo produto em UNIDADES diferentes são cotações diferentes", async () => {
    // O boletim cota o mesmo item em embalagens diferentes com preços
    // diferentes. Se a unidade não entrasse na chave, uma sobrescreveria a outra.
    await importar("TOMATE SALADA;KG;4,00;4,25;4,50", "2026-09-10");

    const doTomate = await prisma.ceasaQuote.findMany({
      where: { centralCode: CENTRAL, product: { slug: "tomate-salada" } },
      orderBy: { unit: "asc" },
      select: { unit: true, refPrice: true },
    });
    expect(doTomate.map((q) => q.unit)).toEqual(["CX 20KG", "KG"]);
  });

  it("dia diferente é boletim diferente — o histórico se acumula", async () => {
    await importar(BOLETIM, "2026-09-11");
    const datas = await prisma.ceasaQuote.findMany({
      where: { centralCode: CENTRAL, product: { slug: "batata-lisa" } },
      select: { quoteDate: true },
      orderBy: { quoteDate: "asc" },
    });
    expect(datas.map((d) => d.quoteDate.toISOString().slice(0, 10))).toEqual([
      "2026-09-10",
      "2026-09-11",
    ]);
  });

  it("produto que já existe no catálogo NÃO é duplicado", async () => {
    const quantos = await prisma.ceasaProduct.count({ where: { slug: "tomate-salada" } });
    expect(quantos).toBe(1);
  });

  it("boletim sem linhas é VAZIO, não FALHA", async () => {
    // Domingo e feriado caem aqui. Marcar como falha ensinaria o operador a
    // ignorar o alarme, e aí a falha de verdade passaria batida também.
    const r = await CotacoesImportService.gravar({
      centralCode: CENTRAL,
      quoteDate: parseFormDateTz("2026-09-13"),
      linhas: [],
      sourceKey: "manual",
    });
    const run = await prisma.ceasaImportRun.findUniqueOrThrow({ where: { id: r.runId } });
    expect(run.status).toBe("VAZIO");
    expect(run.error).toBeNull();
  });

  it("central inexistente é recusada", async () => {
    await expect(
      CotacoesImportService.gravar({
        centralCode: "NAOEXISTE",
        quoteDate: new Date(),
        linhas: [],
        sourceKey: "manual",
      }),
    ).rejects.toThrow(/não encontrada/i);
  });
});

describe("situacaoDasCentrais", () => {
  it("mostra o último boletim e a última execução de cada central", async () => {
    const todas = await CotacoesImportService.situacaoDasCentrais();
    const nossa = todas.find((c) => c.code === CENTRAL)!;

    expect(nossa.ultimoBoletim!.toISOString().slice(0, 10)).toBe("2026-09-11");
    expect(nossa.ultimaExecucao).not.toBeNull();
    // Nenhuma empresa escolheu esta central de teste.
    expect(nossa.clientes).toBe(0);
  });

  it("as sete centrais da CEASAMINAS vieram na migration", async () => {
    // O catálogo entra pela migration, e não pelo seed de desenvolvimento: sem
    // ele o módulo não tem o que oferecer em produção.
    const todas = await CotacoesImportService.situacaoDasCentrais();
    const codigos = todas.map((c) => c.code);
    for (const c of ["CEAMG", "CEARM", "CEART", "CEARG", "CEARD", "CEARB", "CECAT"]) {
      expect(codigos).toContain(c);
    }
  });
});
