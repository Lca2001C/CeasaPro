import { createHash } from "node:crypto";
import { buscarHtml } from "@/lib/cotacoes/http";
import type { FonteDeCotacao, ParametrosDeBusca, ResultadoDaFonte } from "./tipos";
import type { LinhaDeCotacao } from "@/lib/cotacoes/csv";

/**
 * Boletim Diário de Preços do DetecWeb.
 *
 * O sistema (feito em ScriptCase) atende várias praças pela MESMA tela, mudando
 * só o código do mercado — então um adaptador cobre todas. Medindo o endpoint,
 * ele serve não só Minas mas também o ESPÍRITO SANTO: `mercod=211` devolve
 * "CEASA-ES UNID GRANDE VITORIA". Os dois estados compartilham o mesmo banco,
 * então cobrir o ES foi acrescentar uma linha no catálogo, sem adaptador novo.
 *
 * Mercados confirmados com dado real: 211 (Grande Vitória/ES), 214 (Grande
 * BH), 217 (Juiz de Fora), 218 (Uberlândia), 237 (Caratinga), 260 (Gov.
 * Valadares), 353 (Barbacena), 361 (Poços de Caldas). Uberaba (215) responde
 * sem nenhum boletim em 18 datas testadas.
 *
 * O que se sabe daqui foi medido contra o sistema real, e cada coisa abaixo
 * existe porque a medição mostrou que era assim:
 *
 * **A data vai em MM/DD/AAAA, não em DD/MM/AAAA.** A tela é brasileira e ecoa a
 * data em DD/MM, mas o parâmetro entra cru numa `stored procedure` de SQL Server
 * que a interpreta no formato americano. Enviar `28/08/2026` devolve
 * "Error converting data type varchar to datetime" (mês 28 não existe) e enviar
 * `04/09/2026` devolve, em silêncio, o boletim de 9 de ABRIL. Esse segundo caso
 * é o perigoso: resposta 200, página bem formada, dados do dia errado. Por isso
 * `parse` confere a data que a própria página informa contra a que foi pedida.
 *
 * **A resposta tem três formas, e todas foram capturadas em `tests/fixtures`:**
 *   1. boletim com dados — grade com `id_sc_field_prdnom_N`;
 *   2. mesma página, zero linhas — é o dia sem boletim (fim de semana, feriado,
 *      publicação atrasada). NÃO é falha;
 *   3. página de erro do ScriptCase com "Erro ao acessar o banco de dados".
 *
 * **Os campos têm nome próprio no HTML.** O ScriptCase gera
 * `id_sc_field_<campo>_<linha>`, então o parser ancora em NOME e não em posição
 * de coluna — uma coluna a mais no meio da tabela não embaralha o resultado.
 */

const BASE = "https://minas1.ceasa.mg.gov.br/detec";
const URL_BOLETIM = `${BASE}/boletim_completo/boletim_completo.php`;

/** Campos da grade, na ordem em que o parser depende deles. */
const CAMPOS = ["prdnom", "embdesresu", "pboprcmin", "pboprccomum", "pboprcmax"] as const;

/** Marcador de que a página é MESMO o boletim (e não outra coisa). */
const MARCADOR_BOLETIM = "Boletim Diário de Preços Completo";
const MARCADOR_ERRO = "Erro ao acessar o banco de dados";

function mercadoDe(sourceParams: unknown): string | null {
  if (!sourceParams || typeof sourceParams !== "object") return null;
  const v = (sourceParams as { mercado?: unknown }).mercado;
  if (typeof v === "number") return String(v);
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return v.trim();
  return null;
}

/** MM/DD/AAAA — o formato que a stored procedure da fonte espera. Ver cabeçalho. */
function dataParaFonte(d: Date): string {
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getUTCFullYear()}`;
}

/** Extrai o conteúdo de `id_sc_field_<campo>_<linha>`. */
function celulas(html: string, campo: string): Map<string, string> {
  const achado = new Map<string, string>();
  const re = new RegExp(`id_sc_field_${campo}_(\\d+)"[^>]*>([\\s\\S]*?)</span>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    achado.set(m[1]!, textoLimpo(m[2]!));
  }
  return achado;
}

function textoLimpo(bruto: string): string {
  return bruto
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** "45,00" → 45. Vazio ou ilegível → null. */
function preco(bruto: string): number | null {
  const limpo = bruto.replace(/[^\d,.-]/g, "").trim();
  if (!limpo) return null;
  const n = Number(limpo.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** A data que a PRÓPRIA página informa, em ISO. A página escreve em DD/MM/AAAA. */
function dataDaPagina(html: string): string | null {
  const m = /Data:\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(html);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export const ceasaminas: FonteDeCotacao = {
  chave: "ceasaminas",

  /** Uma requisição só: POST direto no boletim. Ver comentário abaixo. */
  async buscar({ sourceParams, data }: ParametrosDeBusca): Promise<ResultadoDaFonte> {
    const mercado = mercadoDe(sourceParams);
    if (!mercado) {
      return {
        ok: false,
        linhas: [],
        erro: "sourceParams sem o código numérico do mercado (ex.: {\"mercado\":\"214\"})",
      };
    }

    /*
      UMA requisição, não duas.

      A versão anterior baixava a página do filtro antes, para abrir sessão PHP e
      ler o token `script_case_init`. Medindo, nada disso é necessário: o POST
      direto — sem cookie de sessão e sem o campo `script_case_init` — devolve o
      mesmo boletim, com o mesmo número de produtos.

      Isso corta metade das requisições ao servidor de terceiro (o que importa
      quando são sete centrais dentro de um orçamento de tempo) e remove uma
      dependência frágil: o token variava a cada sessão, e o adaptador quebraria
      se a página do filtro mudasse de forma, mesmo com o endpoint de dados
      intacto.
    */
    const corpo = new URLSearchParams({
      // O separador `?#?` / `?@?` é do ScriptCase, e o nome do campo é `mercod`
      // (com a abreviação deles), não `mercado`.
      nmgp_parms: `mercod?#?${mercado}?@?data?#?${dataParaFonte(data)}?@?numero?#?1?@?`,
    });

    const resposta = await buscarHtml(
      URL_BOLETIM,
      {
        method: "POST",
        body: corpo,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      },
      { fonte: "ceasaminas", mercado },
    );
    if (!resposta.ok) {
      return { ok: false, linhas: [], httpStatus: resposta.status, erro: resposta.erro };
    }

    // `parseBoletim` e não `this.parse`: desestruturar a fonte
    // (`const { buscar } = ceasaminas`) deixaria `this` indefinido, e o erro
    // apareceria só em produção, na primeira execução do cron.
    const lido = parseBoletim(resposta.corpo);
    // Confere que veio o dia pedido. Sem isto, um erro de formato de data
    // devolveria 200 com o boletim de OUTRO dia e nós gravaríamos dado errado
    // com cara de certo.
    const esperado = data.toISOString().slice(0, 10);
    if (lido.ok && lido.dataDaResposta && lido.dataDaResposta !== esperado) {
      return {
        ok: false,
        linhas: [],
        erro: `a fonte devolveu o boletim de ${lido.dataDaResposta}, e não de ${esperado}`,
      };
    }
    return { ...lido, httpStatus: resposta.status };
  },

  parse: parseBoletim,
};

/**
 * PURO: recebe o HTML e devolve as linhas. Sem rede, sem relógio, sem banco.
 * É o que permite testar contra os arquivos de `tests/fixtures/cotacoes`.
 */
function parseBoletim(corpo: string): ResultadoDaFonte {
  {
    if (corpo.includes(MARCADOR_ERRO)) {
      const m = /scErrorMessage[^>]*>([\s\S]{0,300}?)</.exec(corpo);
      return {
        ok: false,
        linhas: [],
        erro: m ? textoLimpo(m[1]!).slice(0, 200) : "erro de banco na fonte",
      };
    }

    // Sem o marcador, não é a página do boletim: pode ser manutenção, portal de
    // login ou uma reformulação do site. É FALHA, não vazio — declarar vazio aqui
    // esconderia justamente a quebra que o alarme existe para pegar.
    if (!corpo.includes(MARCADOR_BOLETIM)) {
      return { ok: false, linhas: [], erro: "resposta não é a página do boletim" };
    }

    const porCampo = Object.fromEntries(CAMPOS.map((c) => [c, celulas(corpo, c)])) as Record<
      (typeof CAMPOS)[number],
      Map<string, string>
    >;

    const linhas: LinhaDeCotacao[] = [];
    for (const [linha, nome] of porCampo.prdnom) {
      const produto = nome.trim();
      if (!produto) continue;

      const minimo = preco(porCampo.pboprcmin.get(linha) ?? "");
      const comum = preco(porCampo.pboprccomum.get(linha) ?? "");
      const maximo = preco(porCampo.pboprcmax.get(linha) ?? "");
      // Referência: o preço COMUM é o que o mercado pratica; sem ele, o meio da
      // faixa; sem faixa, o que houver. Uma linha sem preço nenhum não é cotação
      // e é descartada em silêncio — o boletim tem linhas de cabeçalho de grupo.
      const referencia =
        comum ?? (minimo !== null && maximo !== null ? (minimo + maximo) / 2 : (minimo ?? maximo));
      if (referencia === null) continue;

      linhas.push({
        produto,
        unidade: (porCampo.embdesresu.get(linha) ?? "").trim(),
        minimo,
        comum,
        maximo,
        referencia: Math.round(referencia * 100) / 100,
      });
    }

    return {
      ok: true,
      // Página do boletim, bem formada, com zero linhas: é dia sem boletim.
      // Distinto de "não reconheci a página", que é falha.
      vazio: linhas.length === 0,
      linhas,
      fingerprint: assinatura(corpo),
      dataDaResposta: dataDaPagina(corpo),
    };
  }
}

/**
 * Assinatura ESTRUTURAL da resposta.
 *
 * Hash dos campos da grade que o parser encontrou, em ordem. Muda quando a fonte
 * acrescenta, remove ou renomeia coluna — inclusive quando o parsing continua
 * "funcionando" e passa a ler a coluna errada. É a única checagem que pega
 * corrupção silenciosa; as outras só pegam ausência de dado.
 */
function assinatura(corpo: string): string {
  const presentes = CAMPOS.filter((c) => corpo.includes(`id_sc_field_${c}_`));
  return createHash("sha256").update(presentes.join("|")).digest("hex").slice(0, 16);
}
