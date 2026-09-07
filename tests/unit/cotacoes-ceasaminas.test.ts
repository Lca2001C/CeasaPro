import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ceasaminas } from "@/lib/cotacoes/fontes/ceasaminas";
import { fontePara, FONTES } from "@/lib/cotacoes/fontes";

/**
 * Parsing do boletim da CEASAMINAS, contra respostas REAIS.
 *
 * Os três arquivos de `tests/fixtures/cotacoes` foram capturados do sistema de
 * verdade (mercado 214 — Grande BH) e são a documentação viva do formato: quem
 * precisar mexer neste parser daqui a um ano não vai ter que adivinhar como a
 * resposta era, nem depender de o site estar no ar naquele dia.
 *
 * Nada aqui toca a rede — `parse` é função pura, e `tests/setup/no-outbound-http.ts`
 * garante que continue assim.
 */

const fixture = (nome: string) =>
  readFileSync(`tests/fixtures/cotacoes/${nome}.html`, "utf8");

describe("ceasaminas.parse — boletim com dados", () => {
  const html = fixture("ceasaminas-ok");
  const r = ceasaminas.parse(html);

  it("lê o boletim inteiro", () => {
    expect(r.ok).toBe(true);
    expect(r.vazio).toBe(false);
    // 215 produtos no boletim de 04/09/2026 da Grande BH.
    expect(r.linhas.length).toBe(215);
  });

  it("lê os valores exatos de uma linha conhecida", () => {
    const alface = r.linhas.find((l) => l.produto === "ALFACE CRESPA PRIMEIRA");
    expect(alface).toBeDefined();
    expect(alface).toMatchObject({
      unidade: "DZ",
      minimo: 25,
      comum: 25,
      maximo: 30,
      // O preço COMUM é o de referência quando existe.
      referencia: 25,
    });
  });

  it("preserva o nome como o boletim escreve — é o que o vínculo manual usa", () => {
    const nomes = r.linhas.map((l) => l.produto);
    expect(nomes.some((n) => n.startsWith("ABACAXI PEROLA"))).toBe(true);
    expect(nomes.some((n) => n.startsWith("BANANA PRATA"))).toBe(true);
  });

  it("toda linha tem preço de referência e nome", () => {
    for (const l of r.linhas) {
      expect(l.produto.length).toBeGreaterThan(0);
      expect(Number.isFinite(l.referencia)).toBe(true);
      expect(l.referencia).toBeGreaterThan(0);
    }
  });

  it("informa a data do próprio boletim, em ISO", () => {
    // A página escreve "Data: 04/09/2026" (DD/MM). É o que `buscar` compara com
    // a data pedida para não gravar o dia errado.
    expect(r.dataDaResposta).toBe("2026-09-04");
  });

  it("o mesmo produto aparece em unidades diferentes, e as duas são mantidas", () => {
    const porChave = new Set(r.linhas.map((l) => `${l.produto}|${l.unidade}`));
    // Nenhuma linha some por colisão de nome: a unidade faz parte da identidade.
    expect(porChave.size).toBe(r.linhas.length);
  });
});

describe("ceasaminas.parse — dia sem boletim", () => {
  const r = ceasaminas.parse(fixture("ceasaminas-vazio"));

  /**
   * ESTE é o caso que sustenta a credibilidade do alarme.
   *
   * Fim de semana, feriado e publicação atrasada caem aqui. Se o parser
   * devolvesse `ok: false`, o super-admin receberia aviso de falha todo sábado e
   * domingo — e em um mês ninguém mais leria aviso nenhum, inclusive o da quebra
   * de verdade.
   */
  it("é OK e VAZIO, não falha", () => {
    expect(r.ok).toBe(true);
    expect(r.vazio).toBe(true);
    expect(r.linhas).toEqual([]);
    expect(r.erro).toBeUndefined();
  });
});

describe("ceasaminas.parse — erro da fonte", () => {
  const r = ceasaminas.parse(fixture("ceasaminas-erro"));

  it("é falha, com a mensagem que a fonte deu", () => {
    expect(r.ok).toBe(false);
    expect(r.vazio).toBeFalsy();
    expect(r.erro).toMatch(/Error converting data type|banco de dados/i);
  });
});

describe("ceasaminas.parse — resposta que não é o boletim", () => {
  /**
   * Manutenção, portal de login, ou o site reformulado. É FALHA e não vazio:
   * declarar vazio aqui esconderia exatamente a quebra que o alarme existe para
   * pegar, e o módulo morreria em silêncio mostrando "sem boletim hoje" para
   * sempre.
   */
  it("HTML desconhecido é falha, não 'dia sem boletim'", () => {
    const r = ceasaminas.parse("<html><body>Em manutenção</body></html>");
    expect(r.ok).toBe(false);
    expect(r.vazio).toBeFalsy();
    expect(r.erro).toMatch(/não é a página do boletim/i);
  });

  it("resposta vazia é falha", () => {
    expect(ceasaminas.parse("").ok).toBe(false);
  });
});

describe("fingerprint — a checagem que pega corrupção silenciosa", () => {
  const ok = fixture("ceasaminas-ok");

  it("é estável para a mesma estrutura", () => {
    expect(ceasaminas.parse(ok).fingerprint).toBe(ceasaminas.parse(ok).fingerprint);
  });

  /**
   * O caso que nenhuma outra checagem pega: a fonte remove uma coluna, o parser
   * continua devolvendo linhas (então não é erro, não é vazio, o cron fica
   * verde), mas o preço lido passa a ser de outro campo. O fingerprint muda e o
   * aviso dispara mesmo com o parsing "funcionando".
   */
  it("muda quando a fonte perde uma coluna", () => {
    const semComum = ok.replace(/id_sc_field_pboprccomum_/g, "id_sc_field_removido_");
    const r = ceasaminas.parse(semComum);
    expect(r.ok).toBe(true);
    expect(r.linhas.length).toBeGreaterThan(0); // continua "funcionando"
    expect(r.fingerprint).not.toBe(ceasaminas.parse(ok).fingerprint); // e mesmo assim acusa
  });

  it("sem a coluna do preço comum, cai para o meio da faixa em vez de zerar", () => {
    const semComum = ok.replace(/id_sc_field_pboprccomum_/g, "id_sc_field_removido_");
    const alface = ceasaminas
      .parse(semComum)
      .linhas.find((l) => l.produto === "ALFACE CRESPA PRIMEIRA")!;
    expect(alface.comum).toBeNull();
    expect(alface.referencia).toBe(27.5); // (25 + 30) / 2
  });
});

describe("a fonte sobrevive a ser desestruturada", () => {
  /**
   * `buscar` chamava `this.parse(...)`. Bastava alguém escrever
   * `const { buscar } = ceasaminas` — ou passar o método como callback — para
   * `this` virar `undefined`, e o erro só apareceria em produção, na primeira
   * execução do cron. Métodos que dependem de `this` num objeto exportado como
   * dado são uma armadilha silenciosa.
   */
  it("parse funciona solto, sem o objeto", () => {
    const { parse } = ceasaminas;
    const r = parse(fixture("ceasaminas-ok"));
    expect(r.ok).toBe(true);
    expect(r.linhas.length).toBe(215);
  });

  it("buscar não depende de `this` para chamar o parser", () => {
    // Não faz requisição: `sourceParams` inválido devolve erro antes de qualquer
    // rede — e é justamente esse caminho que prova que o método é chamável solto.
    const { buscar } = ceasaminas;
    return expect(buscar({ sourceParams: {}, data: new Date() })).resolves.toMatchObject({
      ok: false,
    });
  });
});

describe("registro de fontes", () => {
  it("a chave da fonte é a que o banco guarda em sourceKey", () => {
    expect(fontePara("ceasaminas")).toBe(ceasaminas);
    expect(Object.keys(FONTES)).toContain("ceasaminas");
  });

  it("'manual' NÃO é uma fonte — boletim colado não tem o que buscar", () => {
    // Se fosse, o cron tentaria raspar as centrais alimentadas à mão todo dia e
    // registraria falha para sempre.
    expect(fontePara("manual")).toBeNull();
  });

  it("chave desconhecida devolve null em vez de estourar", () => {
    expect(fontePara("inexistente")).toBeNull();
  });
});
