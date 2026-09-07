import { describe, it, expect } from "vitest";
import {
  NOME_EMPRESA_PADRAO,
  cadastroIncompleto,
  empresaSemNome,
  nomeInicialPeloEmail,
} from "@/lib/tenant-defaults";

/**
 * O cadastro passou a pedir só e-mail e senha, e o preço disso é que a empresa
 * nasce sem nome e sem telefone. Estas funções são as duas pontas dessa troca:
 * o que se grava no lugar, e como o app sabe que ainda falta preencher.
 *
 * São puras porque o cartão do Início (componente de cliente) e o layout
 * (Server Component) precisam da MESMA resposta. Se cada lado decidisse por
 * conta própria, o cartão apareceria para quem já preencheu — ou, pior, nunca
 * apareceria para quem não preencheu, e o cadastro mínimo viraria cadastro
 * eternamente vazio.
 */

describe("nomeInicialPeloEmail", () => {
  it("separa as palavras da parte local e capitaliza", () => {
    expect(nomeInicialPeloEmail("joao.silva@ceasa.com")).toBe("Joao Silva");
    expect(nomeInicialPeloEmail("ana_paula-souza@x.com.br")).toBe("Ana Paula Souza");
  });

  it("normaliza a caixa em vez de repetir o que a pessoa digitou", () => {
    expect(nomeInicialPeloEmail("MARIA@x.com")).toBe("Maria");
    expect(nomeInicialPeloEmail("mArIa.DA.sIlVa@x.com")).toBe("Maria Da Silva");
  });

  it("preserva acento", () => {
    expect(nomeInicialPeloEmail("joão.gonçalves@x.com")).toBe("João Gonçalves");
  });

  it("NUNCA devolve string vazia — a coluna é NOT NULL", () => {
    // Este é o caso que quebraria o INSERT do cadastro, e é a razão de a função
    // ter um fallback em vez de simplesmente juntar as palavras.
    expect(nomeInicialPeloEmail("@x.com")).not.toBe("");
    expect(nomeInicialPeloEmail("...@x.com")).not.toBe("");
    expect(nomeInicialPeloEmail("---@x.com")).not.toBe("");
    expect(nomeInicialPeloEmail("")).not.toBe("");
  });

  it("aceita parte local só de dígitos", () => {
    expect(nomeInicialPeloEmail("123456@x.com")).toBe("123456");
  });

  it("respeita o teto de 120 da coluna", () => {
    const gigante = "a".repeat(300) + "@x.com";
    expect(nomeInicialPeloEmail(gigante).length).toBeLessThanOrEqual(120);
  });
});

describe("empresaSemNome", () => {
  it("reconhece o nome de partida, que é o sinal de 'não preencheu'", () => {
    expect(empresaSemNome(NOME_EMPRESA_PADRAO)).toBe(true);
    // Espaço em volta não pode fazer o aviso sumir sem a pessoa ter preenchido.
    expect(empresaSemNome(`  ${NOME_EMPRESA_PADRAO}  `)).toBe(true);
    expect(empresaSemNome("")).toBe(true);
    expect(empresaSemNome("   ")).toBe(true);
    expect(empresaSemNome(null)).toBe(true);
  });

  it("nome de verdade não é confundido com o de partida", () => {
    expect(empresaSemNome("Hortifrúti Silva")).toBe(false);
    // Contém o padrão, mas não É o padrão.
    expect(empresaSemNome("Minha empresa de tomates")).toBe(false);
  });
});

describe("cadastroIncompleto", () => {
  it("lista o que falta logo depois do cadastro mínimo", () => {
    const faltando = cadastroIncompleto({ tradeName: NOME_EMPRESA_PADRAO, phone: null });
    expect(faltando).toHaveLength(2);
    expect(faltando.join(" ")).toMatch(/nome/i);
    expect(faltando.join(" ")).toMatch(/telefone/i);
  });

  it("some quando a pessoa preenche — senão o aviso ficaria para sempre", () => {
    expect(cadastroIncompleto({ tradeName: "Hortifrúti Silva", phone: "31999999999" })).toEqual([]);
  });

  it("cobra cada campo em separado", () => {
    expect(cadastroIncompleto({ tradeName: "Hortifrúti Silva", phone: null })).toHaveLength(1);
    expect(
      cadastroIncompleto({ tradeName: NOME_EMPRESA_PADRAO, phone: "31999999999" }),
    ).toHaveLength(1);
  });

  it("telefone em branco conta como ausente", () => {
    expect(cadastroIncompleto({ tradeName: "Hortifrúti Silva", phone: "   " })).toHaveLength(1);
  });
});
