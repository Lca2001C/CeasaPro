import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { htmlParaTexto, lerFeed, limparUrl } from "@/lib/noticias/parse";
import { chaveDoTitulo, classificar, familiasCitadas, ilustracaoDaNoticia } from "@/lib/noticias/filtro";
import { idadeDaNoticia } from "@/lib/noticias/tempo";
import { FEEDS } from "@/lib/noticias/fontes";

/**
 * CeasaNews: leitura dos feeds e filtro de assunto, contra feeds REAIS
 * capturados em `tests/fixtures/noticias/` (16/10/2026). Nada aqui toca a rede.
 */

const fixture = (nome: string) => readFileSync(`tests/fixtures/noticias/${nome}.xml`, "utf8");
const ler = (nome: string) => {
  const r = lerFeed(fixture(nome));
  if (!r.ok) throw new Error(r.erro);
  return r.itens;
};

describe("lerFeed — feeds reais", () => {
  it.each([
    ["canalrural", 10],
    ["agenciabrasil", 10],
    ["comprerural", 10],
    ["g1-agro", 15],
    ["googlenews", 25],
  ])("%s: lê todos os itens com título, link e data", (nome, total) => {
    const itens = ler(nome);
    expect(itens).toHaveLength(total);
    for (const i of itens) {
      expect(i.titulo.length).toBeGreaterThan(5);
      expect(i.url).toMatch(/^https?:\/\//);
      expect(Number.isNaN(i.publicadaEm.getTime())).toBe(false);
    }
  });

  it("resumo é texto puro: nada de tag nem entidade sobrando", () => {
    for (const nome of ["canalrural", "agenciabrasil", "comprerural", "g1-agro"]) {
      for (const i of ler(nome)) {
        expect(i.resumo).not.toMatch(/<[a-z/][^>]*>/i);
        expect(i.resumo).not.toMatch(/&(?:[a-z]+|#\d+);/i);
        expect(i.resumo.length).toBeLessThanOrEqual(281);
      }
    }
  });

  it("tira o rodapé automático do WordPress do resumo", () => {
    for (const i of ler("canalrural")) expect(i.resumo).not.toMatch(/apareceu primeiro em/i);
  });

  it("acha a imagem onde cada veículo a põe, e só https", () => {
    for (const nome of ["canalrural", "agenciabrasil", "comprerural"]) {
      const itens = ler(nome);
      expect(itens.every((i) => i.imagemUrl !== null)).toBe(true);
      expect(itens.every((i) => i.imagemUrl!.startsWith("https://"))).toBe(true);
    }
  });

  it("Google Notícias: o veículo vem de <source> e sai do fim do título", () => {
    const [primeiro] = ler("googlenews");
    expect(primeiro!.fonte).toBe("Goias.gov.br");
    expect(primeiro!.titulo).not.toMatch(/ - Goias\.gov\.br$/);
    // O resumo do agregador só repete o título: vira vazio, não ruído.
    expect(primeiro!.resumo).toBe("");
  });

  it("página HTML no lugar do feed é FALHA, não feed vazio", () => {
    const r = lerFeed("<!DOCTYPE html><html><body>Página não encontrada</body></html>");
    expect(r.ok).toBe(false);
  });

  it("feed com um item só (vira objeto, não lista) é lido", () => {
    const r = lerFeed(
      `<rss><channel><item><title>Preço do tomate sobe</title><link>https://x.com/a</link><pubDate>Fri, 16 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>`,
    );
    expect(r.ok && r.itens).toHaveLength(1);
  });

  it("Atom também é lido", () => {
    const r = lerFeed(
      `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Geada atinge hortaliças</title><link rel="alternate" href="https://x.com/b?utm_source=rss"/><updated>2026-10-16T10:00:00Z</updated><summary>Produtores perdem alface.</summary></entry></feed>`,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.itens[0]!.url).toBe("https://x.com/b");
      expect(r.itens[0]!.resumo).toBe("Produtores perdem alface.");
    }
  });

  it("item sem data, sem link ou com link não-http é descartado", () => {
    const r = lerFeed(
      `<rss><channel>
        <item><title>Sem data</title><link>https://x.com/1</link></item>
        <item><title>Sem link</title><pubDate>Fri, 16 Oct 2026 10:00:00 GMT</pubDate></item>
        <item><title>JS</title><link>javascript:alert(1)</link><pubDate>Fri, 16 Oct 2026 10:00:00 GMT</pubDate></item>
      </channel></rss>`,
    );
    expect(r.ok && r.itens).toHaveLength(0);
  });
});

describe("htmlParaTexto e limparUrl", () => {
  it("script, estilo e legenda somem; entidades viram letra", () => {
    expect(
      htmlParaTexto(`<p>Pre&ccedil;o <b>sobe</b></p><script>alert(1)</script><figcaption>Foto: X</figcaption>`),
    ).toBe("Preço sobe");
  });

  it("parâmetros de rastreio e âncora saem do link", () => {
    expect(limparUrl("https://a.com/n?id=3&utm_source=rss&fbclid=x#topo")).toBe("https://a.com/n?id=3");
    expect(limparUrl("ftp://a.com/x")).toBeNull();
  });
});

describe("classificar — o que entra no CeasaNews", () => {
  it("termo forte entra sozinho", () => {
    const c = classificar("Ceasa-PE completa 64 anos com foco em inovação");
    expect(c.aceita).toBe(true);
    expect(c.temas).toContain("CEASA");
  });

  it("alimento com preço entra, com tema de preço", () => {
    const c = classificar("Alface, cebola e tomate ficam mais caros na Ceasa-MS");
    expect(c.aceita).toBe(true);
    expect(c.temas).toEqual(expect.arrayContaining(["CEASA", "PRECOS"]));
  });

  it("alimento com clima entra, com tema de clima", () => {
    const c = classificar("Excesso de chuva reduz colheita e encarece hortaliças para o consumidor");
    expect(c.aceita).toBe(true);
    expect(c.temas).toEqual(expect.arrayContaining(["CLIMA", "SAFRA"]));
  });

  it("frete e diesel no preço da comida entram como logística", () => {
    const c = classificar("Alta do diesel pressiona o frete e o preço dos alimentos");
    expect(c.aceita).toBe(true);
    expect(c.temas).toContain("LOGISTICA");
  });

  it("alimento SEM nada que mexa no preço não entra", () => {
    expect(classificar("Aprenda a criar tilápias em cativeiro").aceita).toBe(false);
    expect(classificar("Batata frita crocante: o segredo do chef").aceita).toBe(false);
  });

  it("assunto do agro que não é hortifruti não entra", () => {
    expect(classificar("STF derrubou cobrança do Funrural, mas restituição enfrenta obstáculos").aceita).toBe(false);
    expect(classificar("Anac estabelece regras mais restritivas para aviação em Congonhas").aceita).toBe(false);
  });

  it("termo negativo derruba mesmo com termo forte", () => {
    expect(classificar("Receitas de tomate para o fim de semana na feira da Ceasa").aceita).toBe(false);
  });

  it("os feeds gerais de agro deixam passar só a minoria", () => {
    const g1 = ler("g1-agro");
    const aceitas = g1.filter((i) => classificar(i.titulo, i.resumo).aceita);
    expect(aceitas.length).toBeGreaterThan(0);
    expect(aceitas.length).toBeLessThan(g1.length / 2);
  });
});

describe("familiasCitadas e chaveDoTitulo", () => {
  it("acha o produto da empresa pela primeira palavra, com acento e plural", () => {
    expect(familiasCitadas("Chuvas elevam preços da alface e das cebolas", ["Alface", "Cebola", "Tomate"])).toEqual([
      "Alface",
      "Cebola",
    ]);
  });

  it("a mesma matéria por dois feeds tem a mesma chave", () => {
    expect(chaveDoTitulo("Preço do Tomate SOBE 56%!")).toBe(chaveDoTitulo("preço do tomate sobe 56%"));
  });
});

describe("ilustracaoDaNoticia", () => {
  const fotos = [
    { chave: "batata", url: "https://img/batata.webp" },
    { chave: "tomate", url: "https://img/tomate.webp" },
  ];
  it("o produto do TÍTULO vence o do resumo", () => {
    expect(ilustracaoDaNoticia("Preço do tomate dispara", "batata também sobe", fotos)).toBe("https://img/tomate.webp");
  });
  it("sem produto no título, usa o do resumo", () => {
    expect(ilustracaoDaNoticia("Chuva atrasa plantio", "Produtores de batatas no PR", fotos)).toBe("https://img/batata.webp");
  });
  it("nenhum produto citado, nenhuma ilustração", () => {
    expect(ilustracaoDaNoticia("Diesel sobe 3%", "Frete fica mais caro", fotos)).toBeNull();
  });
});

describe("idadeDaNoticia", () => {
  const agora = new Date("2026-10-16T15:00:00Z");
  it("minutos e horas, e depois a data em Brasília", () => {
    expect(idadeDaNoticia(new Date("2026-10-16T14:58:00Z"), agora)).toBe("Agora há pouco");
    expect(idadeDaNoticia(new Date("2026-10-16T14:35:00Z"), agora)).toBe("Há 25 minutos");
    expect(idadeDaNoticia(new Date("2026-10-16T13:30:00Z"), agora)).toBe("Há 1 hora");
    expect(idadeDaNoticia(new Date("2026-10-16T12:00:00Z"), agora)).toBe("Há 3 horas");
    expect(idadeDaNoticia(new Date("2026-10-14T12:00:00Z"), agora)).toMatch(/14\/10\/2026/);
  });
});

describe("FEEDS", () => {
  it("chaves únicas, só https", () => {
    expect(new Set(FEEDS.map((f) => f.chave)).size).toBe(FEEDS.length);
    expect(FEEDS.every((f) => f.url.startsWith("https://"))).toBe(true);
  });
});
