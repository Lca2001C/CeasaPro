import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  overrides?: Record<string, Record<string, string>>;
  dependencies: Record<string, string>;
};

/**
 * As duas dependências transitivas vulneráveis, e por que o conserto é um
 * `overrides` e não o que o npm sugere.
 *
 * O `npm audit` apontava duas advisories, e para AS DUAS a correção oferecida
 * (`npm audit fix --force`) era um **downgrade**: `prisma` para 6.12.0 e
 * `exceljs` para 3.4.0, ambos major para trás. Isso não conserta — troca uma
 * falha conhecida por um salto de versão para trás em duas peças centrais do
 * sistema (o ORM e o gerador de relatório), com todas as correções desse
 * intervalo perdidas junto.
 *
 * O conserto de verdade é o contrário: manter `prisma` e `exceljs` onde estão e
 * forçar a transitiva vulnerável para CIMA, que é exatamente o que o campo
 * `overrides` do npm existe para fazer.
 *
 * | pacote | era | virou | advisory |
 * |---|---|---|---|
 * | `deepmerge-ts` (via `@prisma/config`) | 7.1.5 | 8.0.2 | GHSA-ggr8-5vv4-36mx |
 * | `uuid` (via `exceljs`) | 8.3.2 | 11.1.1 | GHSA-w5hq-g745-h8pq |
 *
 * Este arquivo existe porque `overrides` é silencioso: apagar o campo não
 * quebra build, não quebra tipo e não quebra teste — só reinstala a versão
 * vulnerável, e ninguém percebe até o próximo `npm audit`. Um
 * `npm audit fix --force` distraído também os remove.
 */

/** Piso de versão por pacote, com a advisory que o justifica. */
const PISOS = [
  {
    pacote: "deepmerge-ts",
    minimo: [8, 0, 0],
    advisory: "GHSA-ggr8-5vv4-36mx",
    porQue:
      "esgotamento de pilha ao mesclar grafos recursivos; chega aqui pelo carregador de config do CLI do Prisma",
  },
  {
    pacote: "uuid",
    minimo: [11, 1, 1],
    advisory: "GHSA-w5hq-g745-h8pq",
    porQue:
      "falta de checagem de limites de buffer em v3/v5/v6 quando `buf` é passado; chega aqui pelo exceljs",
  },
] as const;

/**
 * Lê a versão instalada direto do disco.
 *
 * `require("<pacote>/package.json")` não serve: o `deepmerge-ts` 8 não expõe
 * `./package.json` no campo `exports`, e o Node recusa com "Package subpath
 * './package.json' is not defined by exports". Ler o arquivo contorna o mapa
 * de exports, que é uma decisão de empacotamento do pacote e não tem nada a
 * ver com a pergunta que se quer responder aqui.
 */
function versaoInstalada(pacote: string): number[] {
  const bruto = readFileSync(`node_modules/${pacote}/package.json`, "utf8");
  const { version } = JSON.parse(bruto) as { version: string };
  return version.split(".").map((n) => parseInt(n, 10));
}

/** `a >= b`, comparando major.minor.patch. */
function atende(a: number[], b: readonly number[]): boolean {
  for (let i = 0; i < b.length; i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
  }
  return true;
}

describe("as transitivas vulneráveis ficaram para cima, não para baixo", () => {
  for (const { pacote, minimo, advisory, porQue } of PISOS) {
    it(`${pacote} >= ${minimo.join(".")} (${advisory})`, () => {
      const atual = versaoInstalada(pacote);
      expect(
        atende(atual, minimo),
        `${pacote} está em ${atual.join(".")}: ${porQue}`,
      ).toBe(true);
    });
  }
});

describe("os overrides continuam declarados", () => {
  /*
    A versão instalada sozinha não basta: `node_modules` pode estar certo por
    acaso numa máquina e errado na próxima instalação limpa. O que garante a
    correção em qualquer `npm ci` é a declaração no `package.json`.
  */
  it("o package.json declara os dois overrides", () => {
    expect(pkg.overrides?.exceljs?.uuid, "override de uuid sob exceljs").toBeDefined();
    expect(
      pkg.overrides?.["@prisma/config"]?.["deepmerge-ts"],
      "override de deepmerge-ts sob @prisma/config",
    ).toBeDefined();
  });

  it("são ESCOPADOS ao pacote que puxa a transitiva", () => {
    /*
      `{"uuid": "^11"}` na raiz forçaria a versão para QUALQUER dependente
      futuro, inclusive um que precise legitimamente da 8. Escopar
      (`{"exceljs": {"uuid": "^11"}}`) conserta o caminho real e deixa o resto
      livre — hoje dá no mesmo, porque cada um tem um único dependente, mas o
      dia em que não der é o dia em que ninguém vai lembrar de reescopar.
    */
    expect(pkg.overrides).toBeDefined();
    for (const chave of Object.keys(pkg.overrides!)) {
      expect(
        typeof pkg.overrides![chave],
        `o override "${chave}" precisa ser um objeto escopado, não uma versão solta`,
      ).toBe("object");
    }
  });
});

describe("o que NÃO pode ter acontecido junto", () => {
  it("prisma e exceljs continuam nas versões maiores, sem downgrade", () => {
    /*
      A trava contra o "conserto" que o npm oferece. Se alguém rodar
      `npm audit fix --force`, o `prisma` volta para 6.12.0 e o `exceljs` para
      3.4.0 — e este caso falha dizendo o que aconteceu, em vez de o downgrade
      entrar em silêncio num commit de rotina.
    */
    const prisma = versaoInstalada("prisma");
    expect(atende(prisma, [6, 19, 0]), `prisma regrediu para ${prisma.join(".")}`).toBe(true);

    const exceljs = versaoInstalada("exceljs");
    expect(atende(exceljs, [4, 0, 0]), `exceljs regrediu para ${exceljs.join(".")}`).toBe(true);
  });

  it("o uuid forçado ainda entrega CJS, que é como o exceljs o carrega", () => {
    /*
      O risco real de pular uuid 8 → 11 não é a API do `v4`, que não mudou: é o
      formato de módulo. O exceljs é CommonJS e faz `require("uuid")`; se a
      versão forçada fosse só ESM, o relatório em Excel quebraria em produção —
      e não no build, porque é carregamento em tempo de execução.

      Isto aqui é a mesma checagem que o `relatorios-export.spec.ts` faz por
      fora baixando o arquivo; aqui ela é barata e falha com a causa na
      mensagem.
    */
    const uuid = require("uuid") as { v4?: unknown };
    expect(typeof uuid.v4, "uuid.v4 não veio por require()").toBe("function");
  });
});
