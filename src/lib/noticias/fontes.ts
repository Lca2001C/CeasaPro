/**
 * Os feeds do CeasaNews.
 *
 * Só RSS/Atom público, sondado antes de entrar: cada URL abaixo respondeu 200
 * com itens recentes, inclusive com o User-Agent do robô. Ficaram de fora, por
 * não terem feed acessível (404/403) ou por feed parado: Conab, HF Brasil/Cepea,
 * Notícias Agrícolas, Embrapa, CEAGESP (feed sem itens) e Agrolink (último item
 * de 2020). O Google Notícias cobre o que esses veículos publicam.
 *
 * Os feeds de site são GERAIS de agro ou de economia: quase tudo neles é soja,
 * boi e juros. O filtro (`filtro.ts`) é que decide o que entra — a fonte só diz
 * de onde buscar.
 */

export interface FeedDeNoticias {
  /** Identidade estável do feed — é o que `NoticiaColeta.feed` guarda. */
  chave: string;
  /** Nome do veículo, quando o próprio feed não diz quem publicou. */
  nome: string;
  url: string;
  /**
   * Agregador (Google Notícias): cada item traz o veículo de verdade em
   * `<source>`, e o título vem com " - Veículo" no fim.
   */
  agregador?: boolean;
}

/** Busca do Google Notícias nos últimos 7 dias, em português do Brasil. */
function googleNoticias(chave: string, consulta: string): FeedDeNoticias {
  const q = encodeURIComponent(`${consulta} when:7d`);
  return {
    chave,
    nome: "Google Notícias",
    url: `https://news.google.com/rss/search?q=${q}&hl=pt-BR&gl=BR&ceid=BR:pt-419`,
    agregador: true,
  };
}

export const FEEDS: readonly FeedDeNoticias[] = [
  { chave: "canalrural", nome: "Canal Rural", url: "https://www.canalrural.com.br/feed/" },
  {
    chave: "g1-agro",
    nome: "g1 Agronegócios",
    url: "https://g1.globo.com/rss/g1/economia/agronegocios/",
  },
  { chave: "comprerural", nome: "Compre Rural", url: "https://www.comprerural.com/feed/" },
  {
    chave: "agenciabrasil",
    nome: "Agência Brasil",
    url: "https://agenciabrasil.ebc.com.br/rss/economia/feed.xml",
  },
  googleNoticias("gn-ceasa", "ceasa OR ceagesp OR ceasaminas"),
  googleNoticias("gn-hortifruti", "hortifruti preço"),
  googleNoticias("gn-produtos", "preço tomate OR batata OR cebola OR alface OR cenoura"),
  googleNoticias("gn-clima", "geada OR estiagem OR chuva hortaliças OR hortifruti OR lavoura"),
  googleNoticias("gn-logistica", "frete OR diesel preço alimentos"),
  googleNoticias("gn-inflacao", "inflação dos alimentos OR cesta básica"),
];
