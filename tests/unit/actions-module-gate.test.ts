import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
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
  "src/actions/cotacoes.actions.ts": "cotacoes",
};

/**
 * Actions que moram em arquivo de NÚCLEO e mesmo assim tocam recurso pago.
 *
 * O mapa acima cobre os arquivos cujo NOME é o do módulo. Ele tinha um ponto
 * cego: `registrarDevolucaoCaixas` vive em `fiado.actions.ts` — núcleo — e
 * escreve em `PlasticCrateMovement`, que é do módulo `caixas`. Passou por todo
 * o CI sem acusar nada até a auditoria de cobertura.
 *
 * A lista é declarada à mão, com o motivo escrito, no mesmo molde do
 * `PLATAFORMA` de `models-tenant-cobertura.test.ts`. Heurística automática não
 * serve aqui: `excluirFiado` também menciona caixas — ela APAGA movimentos ao
 * desfazer a venda — e gateá-la seria errado, porque excluir um fiado é núcleo
 * e apagar o que não existe é inócuo. A diferença entre as duas é intenção, e
 * intenção não se lê por regex.
 */
const ACOES_DE_NUCLEO_COM_MODULO: {
  arquivo: string;
  acao: string;
  modulo: OptionalModuleKey;
  porque: string;
}[] = [
  {
    arquivo: "src/actions/fiado.actions.ts",
    acao: "registrarDevolucaoCaixas",
    modulo: "caixas",
    porque: "cria PlasticCrateMovement (RETORNO) a partir da tela do fiado",
  },
];

/** Serviços que pertencem a um módulo pago — para a varredura rasa. */
const SERVICO_DE_MODULO: Record<string, OptionalModuleKey> = {
  CaixasService: "caixas",
  HigienizacaoService: "higienizacao",
  EmbalagensService: "embalagens",
};

/**
 * Actions que citam um serviço pago no corpo e NÃO devem exigir o módulo.
 *
 * Cada entrada precisa de motivo: é a válvula de escape da varredura rasa, e
 * sem justificativa ela vira o lugar onde se esconde o próximo furo.
 */
const CITA_MAS_NAO_EXIGE: Record<string, string> = {};

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

  it("actions de núcleo que tocam recurso pago declaram o módulo", () => {
    /*
      O ponto cego que esta auditoria fechou. `registrarDevolucaoCaixas`
      escrevia movimento de caixa sem exigir o módulo; funcionava por acidente
      (o invariante de saldo recusa RETORNO acima do que o cliente tem, e quem
      não usa caixas tem saldo zero) e com a mensagem errada.
    */
    const semGate: string[] = [];
    for (const alvo of ACOES_DE_NUCLEO_COM_MODULO) {
      const fonte = readFileSync(alvo.arquivo, "utf8");
      const bloco = blocosDeAction(fonte).find((b) => b.nome === alvo.acao);
      if (!bloco) {
        semGate.push(`${alvo.acao} não existe mais em ${alvo.arquivo}`);
        continue;
      }
      if (!new RegExp(`module:\\s*"${alvo.modulo}"`).test(bloco.corpo)) {
        semGate.push(`${alvo.acao} (${alvo.porque})`);
      }
    }
    expect(semGate, "action de núcleo escrevendo em recurso pago sem gate").toEqual([]);
  });

  it("nenhuma action cita serviço de módulo pago sem exigir o módulo", () => {
    /*
      Varredura RASA, e é o que ela consegue: pega a action que chama
      `CaixasService` direto no corpo. Não pega chamada indireta — foi assim
      que `registrarDevolucaoCaixas` escapou, chamando `FiadoService`, que por
      baixo chama `CaixasService`. Para essa profundidade existe a lista
      declarada acima; esta varredura é a rede automática do caso fácil.
    */
    const arquivos = readdirSync("src/actions").filter((n) => n.endsWith(".actions.ts"));
    expect(arquivos.length, "nenhum arquivo de action encontrado").toBeGreaterThan(5);

    const faltando: string[] = [];
    for (const nome of arquivos) {
      const caminho = `src/actions/${nome}`;
      for (const bloco of blocosDeAction(readFileSync(caminho, "utf8"))) {
        for (const [servico, modulo] of Object.entries(SERVICO_DE_MODULO)) {
          if (!bloco.corpo.includes(`${servico}.`)) continue;
          if (bloco.nome in CITA_MAS_NAO_EXIGE) continue;
          if (!new RegExp(`module:\\s*"${modulo}"`).test(bloco.corpo)) {
            faltando.push(`${nome}:${bloco.nome} usa ${servico} sem module: "${modulo}"`);
          }
        }
      }
    }
    expect(faltando).toEqual([]);
  });

  it("o wrapper realmente aplica o gate", () => {
    // Declarar `module:` só protege se o wrapper chamar `requireModule`.
    const wrapper = readFileSync("src/lib/http/with-action.ts", "utf8");
    expect(wrapper).toContain("requireModule(session.modules, opts.module)");
  });
});
