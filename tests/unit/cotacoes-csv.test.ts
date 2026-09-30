import { describe, it, expect } from "vitest";
import { lerCsvDeCotacoes, MOTIVO_PRECO_NAO_POSITIVO } from "@/lib/cotacoes/csv";

/**
 * O boletim colado é a escotilha do módulo: é o que mantém as cotações de pé no
 * dia em que a fonte mudar de formato e o parser automático quebrar. Por isso
 * ele precisa aceitar o que as pessoas realmente colam — planilha, site, texto
 * com vírgula decimal — em vez de exigir um formato limpo.
 */
describe("lerCsvDeCotacoes", () => {
  it("lê o formato básico", () => {
    const { linhas, erros } = lerCsvDeCotacoes("TOMATE SALADA;CX 20KG;80,00;85,00;92,00");
    expect(erros).toEqual([]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      produto: "TOMATE SALADA",
      unidade: "CX 20KG",
      minimo: 80,
      comum: 85,
      maximo: 92,
      referencia: 85,
    });
  });

  it("aceita tabulação — é o que sai ao colar do Excel", () => {
    const { linhas } = lerCsvDeCotacoes("BATATA\tSC 50KG\t110,00\t118,00\t125,00");
    expect(linhas[0]!.produto).toBe("BATATA");
    expect(linhas[0]!.referencia).toBe(118);
  });

  it("aceita ponto OU vírgula como decimal, e milhar com ponto", () => {
    const { linhas } = lerCsvDeCotacoes(
      ["A;UN;1.234,56;;", "B;UN;1234.56;;", "C;UN;R$ 12,50;;"].join("\n"),
    );
    expect(linhas[0]!.referencia).toBe(1234.56);
    expect(linhas[1]!.referencia).toBe(1234.56);
    expect(linhas[2]!.referencia).toBe(12.5);
  });

  it("pula o cabeçalho da planilha", () => {
    const { linhas } = lerCsvDeCotacoes(
      ["Produto;Unidade;Minimo;Comum;Maximo", "TOMATE;CX;1;2;3"].join("\n"),
    );
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.produto).toBe("TOMATE");
  });

  it("ignora linha em branco", () => {
    const { linhas, erros } = lerCsvDeCotacoes("TOMATE;CX;1;2;3\n\n   \nBATATA;SC;4;5;6");
    expect(linhas).toHaveLength(2);
    expect(erros).toEqual([]);
  });

  /**
   * Uma linha suja não pode derrubar um boletim de 300 linhas: perder o dia
   * inteiro por causa de um caractere seria o pior dos dois mundos. A linha
   * ruim é reportada com o número que a pessoa vê no editor.
   */
  it("linha ruim é ignorada e reportada, o resto entra", () => {
    const { linhas, erros } = lerCsvDeCotacoes(
      ["TOMATE;CX;1;2;3", ";CX;1;2;3", "SEM PRECO;CX;;;", "BATATA;SC;4;5;6"].join("\n"),
    );
    expect(linhas.map((l) => l.produto)).toEqual(["TOMATE", "BATATA"]);
    expect(erros).toEqual([
      { linha: 2, motivo: "sem nome de produto" },
      { linha: 3, motivo: "sem preço" },
    ]);
  });

  it("sem preço comum, usa o meio da faixa", () => {
    const { linhas } = lerCsvDeCotacoes("TOMATE;CX;80,00;;90,00");
    expect(linhas[0]!.referencia).toBe(85);
    expect(linhas[0]!.comum).toBeNull();
  });

  it("com um preço só, usa esse", () => {
    expect(lerCsvDeCotacoes("TOMATE;CX;80,00;;").linhas[0]!.referencia).toBe(80);
    expect(lerCsvDeCotacoes("TOMATE;CX;;;95,00").linhas[0]!.referencia).toBe(95);
  });

  it("unidade vazia é aceita — vira '' e não null", () => {
    // A coluna é NOT NULL no banco de propósito: com NULL, o índice único não
    // colidiria e reimportar o mesmo dia duplicaria a linha.
    const { linhas } = lerCsvDeCotacoes("TOMATE;;1;2;3");
    expect(linhas[0]!.unidade).toBe("");
  });

  it("preço negativo não é preço — e o motivo diz por quê", () => {
    const { linhas, erros } = lerCsvDeCotacoes("TOMATE;CX;-5;;");
    expect(linhas).toEqual([]);
    expect(erros[0]!.motivo).toBe(MOTIVO_PRECO_NAO_POSITIVO);
  });

  /**
   * Zero não é preço.
   *
   * "0,00" é como a planilha de praça manual escreve item sem comercialização.
   * Aceito, virava R$ 0,00 na tela com "−100%", o alerta de piso disparava
   * "caiu 100% (R$ 0,00)" e a praça aparecia como a mais barata no comparativo.
   */
  it("linha toda zerada é recusada com motivo claro", () => {
    const { linhas, erros } = lerCsvDeCotacoes("ALFACE;DZ;0,00;0,00;0,00");
    expect(linhas).toEqual([]);
    expect(erros).toEqual([{ linha: 1, motivo: MOTIVO_PRECO_NAO_POSITIVO }]);
  });

  it("comum zerado com a faixa preenchida cai para o meio da faixa — não zera", () => {
    const { linhas, erros } = lerCsvDeCotacoes("TOMATE;KG;4,00;0,00;5,00");
    expect(erros).toEqual([]);
    expect(linhas[0]).toMatchObject({ minimo: 4, comum: null, maximo: 5, referencia: 4.5 });
  });

  it("mínimo zerado não entra na faixa: usa o que é preço", () => {
    const { linhas } = lerCsvDeCotacoes("TOMATE;KG;0;;5,00");
    expect(linhas[0]).toMatchObject({ minimo: null, maximo: 5, referencia: 5 });
  });

  /**
   * A embalagem é parte da CHAVE da cotação e é comparada por texto exato:
   * "Kg" num boletim e "KG" no seguinte viravam duas séries, e o vínculo
   * gravado numa deixava de casar com a outra.
   */
  it("normaliza a embalagem como os raspadores gravam", () => {
    const { linhas } = lerCsvDeCotacoes(
      ["TOMATE;Kg;1;2;3", "BATATA;  cx   20  kg ;1;2;3", "ALHO; kg ;1;2;3"].join("\n"),
    );
    expect(linhas.map((l) => l.unidade)).toEqual(["KG", "CX 20 KG", "KG"]);
  });

  it("embalagem vazia continua '' depois de normalizar (não vira null)", () => {
    expect(lerCsvDeCotacoes("TOMATE;   ;1;2;3").linhas[0]!.unidade).toBe("");
  });

  it("texto vazio não quebra", () => {
    expect(lerCsvDeCotacoes("")).toEqual({ linhas: [], erros: [] });
    expect(lerCsvDeCotacoes("\n\n\n")).toEqual({ linhas: [], erros: [] });
  });

  it("arredonda o preço para centavos", () => {
    const { linhas } = lerCsvDeCotacoes("TOMATE;CX;80,00;;91,00");
    expect(linhas[0]!.referencia).toBe(85.5);
  });
});
