import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { OPTIONAL_MODULE_KEYS, type OptionalModuleKey } from "@/lib/plan/modules";

/**
 * Toda Server Action de módulo opcional precisa declarar `module`.
 *
 * O bloqueio por rota do `proxy.ts` NÃO cobre Server Action: o id da action é
 * global e ela pode ser invocada por POST a partir de qualquer URL. Uma empresa
 * sem o módulo no plano continuaria alcançando a action se ela dependesse só do
 * gate de caminho — foi exatamente o que aconteceu com
 * `atualizarHigienizacao`, a única das seis irmãs que ficou sem a linha.
 *
 * O teste LÊ O FONTE de propósito. As actions são `"use server"` e não expõem
 * as opções em runtime, então não há como perguntar a elas se estão protegidas.
 * É a mesma estratégia de `relatorios-grupos.test.ts`: pegar a omissão de
 * cadastro, que passa por todo o resto do CI sem acusar nada.
 */

/** Arquivo de actions → módulo do plano que ele exige. */
const ARQUIVOS_POR_MODULO: Record<string, OptionalModuleKey> = {
  "src/actions/caixas.actions.ts": "caixas",
  "src/actions/higienizacao.actions.ts": "higienizacao",
  "src/actions/embalagens.actions.ts": "embalagens",
};

/** Quebra o arquivo nos blocos `withTenantAction({ ... })`, com o nome de cada um. */
function blocosDeAction(fonte: string): { nome: string; corpo: string }[] {
  const blocos: { nome: string; corpo: string }[] = [];
  const re = /export const (\w+) = withTenantAction\(\{([\s\S]*?)\n\}\);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fonte)) !== null) {
    blocos.push({ nome: m[1]!, corpo: m[2]! });
  }
  return blocos;
}

describe("gate de módulo nas Server Actions", () => {
  for (const [arquivo, modulo] of Object.entries(ARQUIVOS_POR_MODULO)) {
    it(`${arquivo}: toda action exige "${modulo}"`, () => {
      const fonte = readFileSync(arquivo, "utf8");
      const blocos = blocosDeAction(fonte);

      // Se o arquivo mudar de forma e o parser não achar nada, o teste tem de
      // falhar — não passar por vacuidade.
      expect(blocos.length, `nenhuma action reconhecida em ${arquivo}`).toBeGreaterThan(0);

      const semGate = blocos
        .filter((b) => !new RegExp(`module:\\s*"${modulo}"`).test(b.corpo))
        .map((b) => b.nome);

      expect(semGate, `sem module: "${modulo}" em ${arquivo}`).toEqual([]);
    });
  }

  it("os módulos cobertos aqui existem no catálogo do plano", () => {
    // Renomear uma chave de módulo sem atualizar este mapa deixaria o teste
    // vigiando um gate que não existe mais.
    for (const modulo of Object.values(ARQUIVOS_POR_MODULO)) {
      expect(OPTIONAL_MODULE_KEYS).toContain(modulo);
    }
  });

  it("o wrapper realmente aplica o gate", () => {
    // Declarar `module:` só protege se o wrapper chamar `requireModule`.
    const wrapper = readFileSync("src/lib/http/with-action.ts", "utf8");
    expect(wrapper).toContain("requireModule(session.modules, opts.module)");
  });
});
