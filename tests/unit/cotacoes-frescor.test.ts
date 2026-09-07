import { describe, it, expect } from "vitest";
import {
  DIAS_ATE_DEFASAGEM,
  frescorDoBoletim,
  rotuloDeFrescor,
} from "@/lib/cotacoes/frescor";

/**
 * O módulo foi pedido como "cotação em tempo real", e tempo real não existe: as
 * centrais publicam um boletim por dia. Estes testes fixam a única coisa que
 * torna isso honesto — a idade do dado sendo visível e virando aviso quando
 * cresce.
 */

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
// Uma quinta-feira, meio da tarde no Brasil.
const AGORA = new Date("2026-09-10T18:00:00.000Z");

describe("frescorDoBoletim", () => {
  it("boletim de hoje é atual", () => {
    expect(frescorDoBoletim(dia("2026-09-10"), AGORA)).toEqual({ nivel: "atual", dias: 0 });
  });

  it("boletim de ontem ainda é atual — é o caso NORMAL do módulo", () => {
    // O cron roda de madrugada e pega o boletim do dia anterior. Chamar isso de
    // atraso poria um selo de aviso na tela todo santo dia, e em uma semana
    // ninguém mais leria selo nenhum.
    expect(frescorDoBoletim(dia("2026-09-09"), AGORA).nivel).toBe("atual");
  });

  it("dois e três dias são atraso, quatro é defasagem", () => {
    expect(frescorDoBoletim(dia("2026-09-08"), AGORA).nivel).toBe("atrasado");
    expect(frescorDoBoletim(dia("2026-09-07"), AGORA).nivel).toBe("atrasado");
    expect(frescorDoBoletim(dia("2026-09-06"), AGORA).nivel).toBe("defasado");
  });

  it("o limiar da tela É a constante do alarme", () => {
    // Importada dos dois lados de propósito: se divergirem, a tela diz que está
    // tudo bem enquanto o super-admin recebe alarme — ou o contrário, que é
    // pior.
    const noLimite = dia("2026-09-10");
    noLimite.setUTCDate(noLimite.getUTCDate() - DIAS_ATE_DEFASAGEM);
    expect(frescorDoBoletim(noLimite, AGORA).nivel).toBe("atrasado");

    const passandoDoLimite = dia("2026-09-10");
    passandoDoLimite.setUTCDate(passandoDoLimite.getUTCDate() - DIAS_ATE_DEFASAGEM - 1);
    expect(frescorDoBoletim(passandoDoLimite, AGORA).nivel).toBe("defasado");
  });

  it("sem boletim é 'ausente', não zero dias", () => {
    // A diferença importa na tela: "sem boletim" e "boletim de hoje" não podem
    // renderizar igual.
    expect(frescorDoBoletim(null, AGORA)).toEqual({ nivel: "ausente", dias: null });
    expect(frescorDoBoletim(undefined, AGORA).nivel).toBe("ausente");
  });

  it("hora do dia não muda a idade — a comparação é por dia de calendário", () => {
    const cedo = new Date("2026-09-10T03:30:00.000Z");
    const tarde = new Date("2026-09-10T23:45:00.000Z");
    expect(frescorDoBoletim(dia("2026-09-10"), cedo).dias).toBe(0);
    expect(frescorDoBoletim(dia("2026-09-10"), tarde).dias).toBe(0);
  });

  it("data no futuro não vira '-1 dia' na tela", () => {
    // Relógio do servidor adiantado, ou boletim publicado com data de amanhã.
    expect(frescorDoBoletim(dia("2026-09-11"), AGORA).nivel).toBe("atual");
  });
});

describe("rotuloDeFrescor", () => {
  it("cala quando o dado está atual", () => {
    expect(rotuloDeFrescor(frescorDoBoletim(dia("2026-09-10"), AGORA))).toBeNull();
    expect(rotuloDeFrescor(frescorDoBoletim(dia("2026-09-09"), AGORA))).toBeNull();
  });

  it("diz a idade quando ela importa", () => {
    expect(rotuloDeFrescor(frescorDoBoletim(dia("2026-09-08"), AGORA))).toMatch(/anteontem/i);
    expect(rotuloDeFrescor(frescorDoBoletim(dia("2026-09-07"), AGORA))).toMatch(/3 dias/);
    expect(rotuloDeFrescor(frescorDoBoletim(dia("2026-09-01"), AGORA))).toMatch(/sem boletim novo/i);
    expect(rotuloDeFrescor(frescorDoBoletim(null, AGORA))).toMatch(/sem boletim/i);
  });
});
