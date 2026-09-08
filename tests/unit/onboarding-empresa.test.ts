import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { empresaSchema } from "@/lib/validations/config";

/**
 * O passo 1 do onboarding não pode apagar dado que já existe.
 *
 * `ConfigService.updateCompany` grava os SEIS campos da empresa de uma vez —
 * não há "não mexer neste": o que a tela não mandar vira `null`. E o passo 1 do
 * onboarding mandava `legalName: null, cnpj: null, businessHours: null` fixos,
 * com telefone e endereço partindo de string vazia porque a página só buscava o
 * nome.
 *
 * O resultado era perda silenciosa em todo cliente novo: o telefone é
 * OBRIGATÓRIO no cadastro público e é o único contato do box; a empresa criada
 * pelo admin já vem com CNPJ e razão social digitados pelo suporte. Tudo isso
 * ia embora no primeiro clique em "Continuar", e o dono reencontrava os campos
 * vazios em Configurações.
 *
 * Este teste é a rede para o próximo campo: acrescentar um sétimo em
 * `empresaSchema` sem ensiná-lo ao wizard faz o onboarding apagá-lo, sem erro
 * nenhum em tempo de compilação (os campos são `.nullable().optional()`).
 */

const wizard = readFileSync("src/app/onboarding/_components/wizard.tsx", "utf8");
const pagina = readFileSync("src/app/onboarding/page.tsx", "utf8");

describe("onboarding e os campos da empresa", () => {
  const campos = Object.keys(empresaSchema.shape);

  it("o contrato tem os campos que se espera", () => {
    // Se o schema encolher a ponto de esvaziar, o resto do teste passaria vazio.
    expect(campos).toContain("tradeName");
    expect(campos).toContain("cnpj");
    expect(campos.length).toBeGreaterThanOrEqual(6);
  });

  it("o wizard conhece todo campo que ele vai sobrescrever", () => {
    // Editado no formulário ou repassado em `preservar` — o que não aparecer
    // aqui é apagado quando o passo 1 salva.
    const desconhecidos = campos.filter((c) => !wizard.includes(c) && !pagina.includes(c));
    expect(
      desconhecidos,
      "campo de empresa que o onboarding sobrescreve sem conhecer — vira null no primeiro Continuar",
    ).toEqual([]);
  });

  it("não sobrou `null` fixo no lugar dos campos preservados", () => {
    for (const campo of ["legalName", "cnpj", "businessHours"]) {
      expect(
        wizard.includes(`${campo}: null`),
        `${campo}: null fixo no wizard apaga o que já estava cadastrado`,
      ).toBe(false);
    }
  });

  it("a página busca os campos, em vez de partir do vazio", () => {
    // `useState("")` para telefone/endereço zerava o que o cadastro gravou.
    expect(pagina).toContain("phone: true");
    expect(pagina).toContain("cnpj: true");
    expect(wizard).toContain("useState(initialPhone)");
  });
});
