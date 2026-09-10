import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ceagesp, lerGruposPublicados } from "@/lib/cotacoes/fontes/ceagesp";

/**
 * O adaptador da CEAGESP, contra o boletim REAL.
 *
 * As três fixtures foram capturadas da fonte, cruas, e é o que dá valor a este
 * arquivo: `parse` é puro justamente para poder ser confrontado com o HTML que a
 * CEAGESP serve de verdade, e não com um HTML que eu imaginei que ela serviria.
 *
 * A `-ok` é o grupo FRUTAS de 04/09/2026 (199 produtos). A `-vazio` é a mesma
 * página respondida para um dia sem publicação — que a fonte devolve como o
 * FORMULÁRIO, sem tabela. A `-erro` é a página de erro fatal do WordPress.
 */

const fixture = (nome: string) => readFileSync(`tests/fixtures/cotacoes/${nome}`, "utf8");
const OK = fixture("ceagesp-ok.html");
const VAZIO = fixture("ceagesp-vazio.html");
const ERRO = fixture("ceagesp-erro.html");

describe("CEAGESP — boletim válido", () => {
  const r = ceagesp.parse(OK);

  it("lê as 199 linhas do grupo", () => {
    expect(r.ok).toBe(true);
    expect(r.vazio).toBeFalsy();
    expect(r.linhas).toHaveLength(199);
  });

  it("a primeira linha bate com o arquivo, valor por valor", () => {
    // <td>ABACATE AVOCADO/HASS/FUERTE</td><td>A</td><td>KG</td>
    // <td>10,27</td><td>11,27</td><td>12,28</td>
    expect(r.linhas[0]).toEqual({
      produto: "ABACATE AVOCADO/HASS/FUERTE A",
      unidade: "KG",
      minimo: 10.27,
      comum: 11.27,
      maximo: 12.28,
      // O "comum" é o valor mais praticado, e é ele que vira referência.
      referencia: 11.27,
    });
  });

  /*
    O caso que decide a correção do adaptador.

    "ABACATE BREDA" aparece DUAS vezes no boletim, com classificações e preços
    diferentes (BOCA 08 A 11 a R$ 4,89; BOCA 12 A 15 a R$ 4,04). O slug do
    produto é derivado do nome, e a chave de gravação é (produto, unidade): se a
    classificação não entrasse no nome, as duas linhas colidiriam e a dedup de
    `gravar` descartaria uma em SILÊNCIO — publicando um preço só para as duas
    qualidades.
  */
  it("a classificação entra no nome, senão linhas do mesmo produto colidem", () => {
    const bredas = r.linhas.filter((l) => l.produto.startsWith("ABACATE BREDA"));
    expect(bredas).toHaveLength(2);
    expect(bredas.map((l) => l.produto)).toEqual([
      "ABACATE BREDA BOCA 08 A 11",
      "ABACATE BREDA BOCA 12 A 15",
    ]);
    expect(bredas.map((l) => l.referencia)).toEqual([4.89, 4.04]);
  });

  it("nenhuma chave (produto+unidade) se repete no boletim inteiro", () => {
    // É a garantia acima, medida sobre as 199 linhas em vez de sobre um exemplo.
    const chaves = r.linhas.map((l) => `${l.produto}|${l.unidade}`);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it("todo preço de referência é positivo e finito", () => {
    for (const l of r.linhas) {
      expect(Number.isFinite(l.referencia)).toBe(true);
      expect(l.referencia).toBeGreaterThan(0);
    }
  });

  /*
    A data que a página imprime é ECO DA ENTRADA, não do banco — medido enviando
    "04/09/2026xyz" e recebendo o lixo de volta no cabeçalho com as linhas certas.
    Então `dataDaResposta` existe, mas quem confere a data de verdade é
    `lerGruposPublicados` (a lista que o servidor renderiza a partir do banco).
  */
  it("devolve o eco da data, que é o que a fonte imprime", () => {
    expect(r.dataDaResposta).toBe("2026-09-04");
  });
});

describe("CEAGESP — os três estados", () => {
  it("dia sem publicação é VAZIO, não falha", () => {
    // A fonte responde com o formulário, sem tabela. Chamar isso de falha faria
    // o alarme tocar em todo domingo, feriado e dia sem publicação — e um alarme
    // que toca à toa é desligado.
    const r = ceagesp.parse(VAZIO);
    expect(r.ok).toBe(true);
    expect(r.vazio).toBe(true);
    expect(r.linhas).toEqual([]);
  });

  it("página de erro do WordPress é FALHA", () => {
    const r = ceagesp.parse(ERRO);
    expect(r.ok).toBe(false);
    expect(r.linhas).toEqual([]);
    expect(r.erro).toBeTruthy();
  });

  it("página irreconhecível é FALHA, nunca vazio", () => {
    /*
      A distinção que a auditoria de 07/09 cobra. Se a CEAGESP trocar o layout,
      a resposta deixa de ter a tabela — exatamente como um dia sem boletim.
      Tratar as duas do mesmo jeito faria a quebra do raspador se disfarçar de
      feriado, indefinidamente, sem ninguém ser avisado. O que distingue é a
      presença de `var Grupos`, que a fonte renderiza em toda página real.
    */
    const r = ceagesp.parse("<html><body>nada aqui</body></html>");
    expect(r.ok).toBe(false);
    expect(r.vazio).toBeFalsy();
  });
});

describe("CEAGESP — fingerprint estrutural", () => {
  it("é estrutural: a mesma resposta dá a mesma assinatura", () => {
    expect(ceagesp.parse(OK).fingerprint).toBe(ceagesp.parse(OK).fingerprint);
  });

  it("NÃO é hash do corpo: mudar um preço não muda a assinatura", () => {
    /*
      O ponto do fingerprint é acusar mudança de FORMATO, não de conteúdo. A
      resposta traz um nonce do Cloudflare que muda a cada requisição, então um
      hash de corpo mudaria em toda execução e o aviso "formato mudou" viraria
      ruído no primeiro dia — levando junto a única defesa contra "colunas
      trocadas, mínimo virou máximo".
    */
    const mexido = OK.replace("10,27", "99,99");
    expect(mexido).not.toBe(OK);
    expect(ceagesp.parse(mexido).fingerprint).toBe(ceagesp.parse(OK).fingerprint);
  });

  it("renomear uma coluna MUDA a assinatura", () => {
    const renomeado = OK.replace("<b>Comum</b>", "<b>Mais praticado</b>");
    expect(renomeado).not.toBe(OK);
    expect(ceagesp.parse(renomeado).fingerprint).not.toBe(ceagesp.parse(OK).fingerprint);
  });
});

describe("CEAGESP — as datas que a fonte declara ter", () => {
  /*
    `var Grupos` é a lista, renderizada pelo servidor a partir do banco, das datas
    que TÊM boletim por categoria. É o único sinal de data confiável desta fonte:
    o cabeçalho "Data:" é eco do que se enviou.
  */
  it("lê a lista de datas publicadas, por categoria", () => {
    const g = lerGruposPublicados(OK);
    expect(g).not.toBeNull();
    expect(g!.nomes.length).toBeGreaterThan(0);
    const frutas = g!.datas.get("FRUTAS");
    expect(frutas?.tipo).toBe("lista");
    if (frutas?.tipo === "lista") {
      // A data da fixture tem de estar entre as declaradas.
      expect(frutas.datas).toContain("2026-09-04");
    }
  });

  it("a lista aparece também na página sem boletim", () => {
    // É o que permite distinguir "dia sem publicação" de "layout quebrado".
    expect(lerGruposPublicados(VAZIO)).not.toBeNull();
  });

  it("categoria que a fonte declara como null é 'nenhuma', não erro", () => {
    // ORGÂNICOS vem `null` — a categoria existe e nunca publicou. Ler isso como
    // ilegível faria o adaptador reclamar de um estado normal da fonte.
    const g = lerGruposPublicados(OK)!;
    const organicos = g.datas.get("ORGANICOS");
    if (organicos) expect(organicos.tipo).toBe("nenhuma");
  });

  it("página sem a lista devolve null, e é o que vira falha", () => {
    expect(lerGruposPublicados("<html><body>nada</body></html>")).toBeNull();
  });
});
