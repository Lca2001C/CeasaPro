import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  pesoEmKg,
  precoPorKg,
  rotuloDeEmbalagem,
  sugerirUnidade,
} from "@/lib/cotacoes/embalagem";

/**
 * A embalagem do boletim.
 *
 * As unidades usadas aqui NÃO são inventadas: são as que aparecem no boletim
 * real da CEASAMINAS gravado em `tests/fixtures/cotacoes/ceasaminas-ok.html`.
 * Testar contra vocabulário imaginado é o que faria o parser passar aqui e
 * falhar no primeiro boletim de verdade.
 */

const dec = (v: string) => new Prisma.Decimal(v);

describe("pesoEmKg — o que a embalagem pesa", () => {
  it("KG puro pesa 1: é a cotação por quilo", () => {
    expect(pesoEmKg("KG")?.toString()).toBe("1");
  });

  it("lê o peso que a fonte declara no fim do texto", () => {
    expect(pesoEmKg("DZ 4 KG")?.toString()).toBe("4");
    expect(pesoEmKg("UN 1,5 KG")?.toString()).toBe("1.5");
    expect(pesoEmKg("MO 0,33 KG")?.toString()).toBe("0.33");
    expect(pesoEmKg("BAND 0,4 KG")?.toString()).toBe("0.4");
  });

  it("aceita sigla com barra e peso de três casas", () => {
    // `MC/M 0,07 KG` é maço; a barra na sigla não pode atrapalhar a leitura.
    expect(pesoEmKg("MC/M 0,07 KG")?.toString()).toBe("0.07");
  });

  it("zero à esquerda e vírgula com dois dígitos não mudam o valor", () => {
    expect(pesoEmKg("DZ 1,70 KG")?.toString()).toBe("1.7");
    expect(pesoEmKg("CX 06 KG")?.toString()).toBe("6");
  });

  /*
    O caso que justifica o arquivo inteiro. Estas embalagens existem no boletim
    e NÃO trazem peso: uma dúzia de quê? trinta dúzias de um item cujo peso
    ninguém publicou? Chutar 12 kg produziria um R$/kg plausível e errado.
  */
  it("embalagem sem peso declarado devolve null em vez de chute", () => {
    expect(pesoEmKg("DZ")).toBeNull();
    expect(pesoEmKg("CX 30 DZ")).toBeNull();
    expect(pesoEmKg("CX 50 DZ")).toBeNull();
    expect(pesoEmKg("CX 06 UN")).toBeNull();
  });

  it("peso no MEIO do texto não conta como peso do produto", () => {
    // "CX 20 KG BRUTO" é o peso da caixa cheia COM a caixa. Recusar é a escolha
    // barata: perde-se uma conversão, não se ganha um número errado.
    expect(pesoEmKg("CX 20 KG BRUTO")).toBeNull();
  });

  it("embalagem vazia é 'o boletim não disse', não 1 kg", () => {
    // Boletim manual pode vir sem embalagem — a coluna é NOT NULL com default ''.
    expect(pesoEmKg("")).toBeNull();
    expect(pesoEmKg("   ")).toBeNull();
    expect(pesoEmKg(null)).toBeNull();
    expect(pesoEmKg(undefined)).toBeNull();
  });

  it("peso zerado ou negativo é erro de digitação, não medida", () => {
    expect(pesoEmKg("CX 0 KG")).toBeNull();
    expect(pesoEmKg("CX 0,00 KG")).toBeNull();
  });

  it("não depende de caixa alta: boletim manual é digitado à mão", () => {
    expect(pesoEmKg("kg")?.toString()).toBe("1");
    expect(pesoEmKg("cx 20 kg")?.toString()).toBe("20");
  });
});

describe("precoPorKg", () => {
  it("divide o preço da embalagem pelo peso dela", () => {
    expect(precoPorKg(dec("84.00"), "CX 20 KG")?.toString()).toBe("4.2");
  });

  it("cotação por quilo já é o preço do quilo", () => {
    expect(precoPorKg(dec("4.20"), "KG")?.toString()).toBe("4.2");
  });

  it("arredonda para centavos, como todo dinheiro do sistema", () => {
    // 0,50 / 0,07 = 7,142857…
    expect(precoPorKg(dec("0.50"), "MC/M 0,07 KG")?.toString()).toBe("7.14");
  });

  it("sem peso declarado devolve null, nunca zero", () => {
    // Zero aqui não leria como "não sei" — leria como "está de graça". É o
    // motivo de esta função não usar o `div` de money.ts, que devolve 0 na
    // divisão por zero.
    expect(precoPorKg(dec("120.00"), "CX 30 DZ")).toBeNull();
    expect(precoPorKg(dec("18.00"), "DZ")).toBeNull();
  });

  it("preço ausente ou não positivo não vira R$/kg", () => {
    expect(precoPorKg(null, "KG")).toBeNull();
    expect(precoPorKg(undefined, "KG")).toBeNull();
    expect(precoPorKg(dec("0"), "KG")).toBeNull();
  });

  it("aceita number e string, que é como o preço chega das bordas", () => {
    expect(precoPorKg(84, "CX 20 KG")?.toString()).toBe("4.2");
    expect(precoPorKg("84.00", "CX 20 KG")?.toString()).toBe("4.2");
  });
});

describe("sugerirUnidade", () => {
  const doBoletim = ["KG", "CX 20 KG", "CX 30 DZ", "DZ"];

  it("quem vende por quilo casa com a linha KG, e só com ela", () => {
    expect(sugerirUnidade("KG", doBoletim)).toBe("KG");
  });

  it("quem vende por caixa casa com a sigla CX", () => {
    expect(sugerirUnidade("CAIXA", doBoletim)).toBe("CX 20 KG");
  });

  it("entre duas caixas, prefere a que o cadastro do produto descreve", () => {
    // `qtyPerRecipient` = 12 e existe `CX 12 KG`: é a mesma caixa.
    const unidades = ["CX 20 KG", "CX 12 KG"];
    expect(sugerirUnidade("CAIXA", unidades, 12)).toBe("CX 12 KG");
  });

  it("sem dica, prefere a caixa COM peso: só ela rende R$/kg na tela", () => {
    expect(sugerirUnidade("CAIXA", ["CX 30 DZ", "CX 20 KG"])).toBe("CX 20 KG");
  });

  it("empate resolve por ordem alfabética, para a sugestão não oscilar", () => {
    // Duas aberturas da mesma tela têm de propor a mesma coisa.
    const unidades = ["CX 50 DZ", "CX 30 DZ"];
    expect(sugerirUnidade("CAIXA", unidades)).toBe("CX 30 DZ");
    expect(sugerirUnidade("CAIXA", [...unidades].reverse())).toBe("CX 30 DZ");
  });

  it("sem embalagem correspondente, cai no quilo — que é referência útil", () => {
    // Quem vende bandeja numa praça que só publica quilo continua enxergando
    // o mercado; a alternativa seria não oferecer nada.
    expect(sugerirUnidade("BANDEJA", ["KG", "CX 20 KG"])).toBe("KG");
  });

  it("sem nada que sirva, devolve null e a escolha fica com o cliente", () => {
    expect(sugerirUnidade("BANDEJA", ["CX 30 DZ", "DZ"])).toBeNull();
    expect(sugerirUnidade("CAIXA", [])).toBeNull();
  });

  it("reconhece as siglas de saco e de bandeja do boletim", () => {
    expect(sugerirUnidade("SACO", ["KG", "SC 60 KG"])).toBe("SC 60 KG");
    expect(sugerirUnidade("BANDEJA", ["KG", "BAND 0,4 KG"])).toBe("BAND 0,4 KG");
  });

  it("dica de peso zerada é ignorada em vez de estreitar a busca", () => {
    expect(sugerirUnidade("CAIXA", ["CX 30 DZ", "CX 20 KG"], 0)).toBe("CX 20 KG");
    expect(sugerirUnidade("CAIXA", ["CX 30 DZ", "CX 20 KG"], null)).toBe("CX 20 KG");
  });
});

describe("rotuloDeEmbalagem", () => {
  it("mostra a embalagem como a fonte escreveu", () => {
    expect(rotuloDeEmbalagem("CX 20 KG")).toBe("CX 20 KG");
  });

  it("embalagem vazia ganha frase, não travessão solto", () => {
    expect(rotuloDeEmbalagem("")).toBe("sem embalagem informada");
    expect(rotuloDeEmbalagem(null)).toBe("sem embalagem informada");
  });
});
