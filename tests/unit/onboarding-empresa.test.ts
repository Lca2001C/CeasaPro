import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { empresaSchema } from "@/lib/validations/config";

/**
 * O passo 1 do onboarding não pode apagar dado que já existe.
 *
 * O defeito original: `ConfigService.updateCompany` gravava os seis campos da
 * empresa de uma vez — não havia "não mexer neste" — e o passo 1 mandava
 * `legalName: null, cnpj: null, businessHours: null` fixos, com telefone e
 * endereço partindo de string vazia porque a página só buscava o nome. Era
 * perda silenciosa em todo cliente novo: o telefone é OBRIGATÓRIO no cadastro
 * público e é o único contato do box; a empresa criada pelo admin já vem com
 * CNPJ e razão social digitados pelo suporte.
 *
 * **A premissa deste teste mudou, e por isso ele mudou junto.** A primeira
 * correção foi devolver os campos intactos num objeto `preservar`, e o teste
 * cobrava que todo campo do schema aparecesse no wizard ou na página. Isso
 * resolvia o sintoma e tinha dois custos: o formulário reescrevia valores lidos
 * no carregamento (desfazendo alteração feita em outra aba), e cada campo novo
 * da empresa precisava ser lembrado no wizard sob pena de voltar a ser apagado
 * — foi exatamente o que aconteceu quando `uf` e `establishmentType` entraram
 * no schema.
 *
 * Hoje a correção está na RAIZ: `updateCompany` só escreve as chaves PRESENTES
 * na entrada (`tests/integration/config-empresa-parcial.test.ts` prova as três
 * pontas — ausente preserva, `null` explícito limpa, `""` limpa). O passo 1
 * manda o que edita, e o resto fica intocado por construção.
 *
 * O que este teste guarda agora é essa invariante, e não a lista de campos: o
 * wizard só pode mandar chaves de campo que ele realmente edita. Voltar a
 * mandar `null` fixo, ou espalhar um objeto de campos que ele não edita, é o
 * caminho de volta para o defeito — e nenhuma das duas coisas quebra tipo.
 */

const wizard = readFileSync("src/app/onboarding/_components/wizard.tsx", "utf8");
const pagina = readFileSync("src/app/onboarding/page.tsx", "utf8");

/** Os três campos que o passo 1 realmente edita. */
const EDITADOS = ["tradeName", "phone", "address"];

describe("onboarding e os campos da empresa", () => {
  const campos = Object.keys(empresaSchema.shape);

  it("o contrato tem os campos que se espera", () => {
    // Se o schema encolher a ponto de esvaziar, o resto do teste passaria vazio.
    expect(campos).toContain("tradeName");
    expect(campos).toContain("cnpj");
    expect(campos.length).toBeGreaterThanOrEqual(6);
  });

  it("não sobrou `null` fixo no lugar dos campos que o passo não edita", () => {
    for (const campo of campos.filter((c) => !EDITADOS.includes(c))) {
      expect(
        wizard.includes(`${campo}: null`),
        `${campo}: null fixo no wizard apaga o que já estava cadastrado`,
      ).toBe(false);
    }
  });

  it("o passo 1 não espalha um objeto de campos que ele não edita", () => {
    /*
      `...preservar` (ou qualquer spread) na chamada de `salvarEmpresa` traz de
      volta os dois problemas de uma vez: reescreve valor lido no carregamento
      da página, e volta a exigir que cada campo novo seja lembrado aqui.
      A chamada tem de listar só o que o formulário edita.
    */
    const chamada = wizard.slice(
      wizard.indexOf("salvarEmpresa({"),
      wizard.indexOf("});", wizard.indexOf("salvarEmpresa({")),
    );
    expect(chamada, "não achou a chamada de salvarEmpresa").not.toBe("");
    expect(chamada.includes("..."), `spread na chamada: ${chamada}`).toBe(false);
    for (const campo of campos) {
      if (EDITADOS.includes(campo)) continue;
      expect(
        chamada.includes(campo),
        `o passo 1 manda "${campo}", que ele não edita`,
      ).toBe(false);
    }
  });

  it("a página busca o que o formulário edita, em vez de partir do vazio", () => {
    // `useState("")` para telefone/endereço zerava o que o cadastro gravou.
    expect(pagina).toContain("phone: true");
    expect(pagina).toContain("address: true");
    expect(wizard).toContain("useState(initialPhone)");
    expect(wizard).toContain("useState(initialAddress)");
  });
});
