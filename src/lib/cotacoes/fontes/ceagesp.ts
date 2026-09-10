import { createHash } from "node:crypto";
import { buscarHtml } from "@/lib/cotacoes/http";
import type { FonteDeCotacao, ParametrosDeBusca, ResultadoDaFonte } from "./tipos";
import type { LinhaDeCotacao } from "@/lib/cotacoes/csv";

/**
 * Boletim de Preços da CEAGESP — Entreposto Terminal de São Paulo.
 *
 * O boletim vem de um WordPress: `POST https://ceagesp.gov.br/cotacoes/` com
 * `cot_grupo` e `cot_data` em `application/x-www-form-urlencoded`, e a resposta
 * é a própria página com a tabela dentro. Sem cookie de sessão, sem nonce, sem
 * GET prévio — o POST cru funciona na primeira tentativa (medido).
 *
 * Tudo o que está escrito abaixo foi MEDIDO contra a fonte real, e cada defesa
 * do arquivo existe porque a medição mostrou que era necessária.
 *
 * **UM GRUPO POR REQUISIÇÃO, e não há como pedir vários.** `cot_grupo[]=FRUTAS`
 * devolve HTTP 500 (erro fatal do PHP), `cot_grupo=FRUTAS,LEGUMES`, `TODOS` e
 * `%` devolvem 200 sem tabela, e o campo duplicado faz vencer o último. Então o
 * boletim de um dia custa uma requisição por categoria: medido em 04/09/2026,
 * ~1,7 s cada — DIVERSOS 31 linhas, FLORES 75, FRUTAS 199, LEGUMES 119,
 * ORGÂNICOS 0, PESCADOS 70, VERDURAS 79 (573 linhas em 11,9 s).
 *
 * **Por que isso obrigou o desvio pelo `var Grupos` (o ponto mais importante
 * daqui).** O importador recua até `MAX_DIAS_DE_RECUO` = 7 dias procurando
 * boletim, e o cron inteiro tem orçamento de 40 s (ver
 * `docs/auditoria-2026-09-07.md`). Sete dias × quatro categorias × 1,7 s = 47 s:
 * uma central sozinha estouraria o orçamento de todas. A saída não é chutar
 * menos dias, é PARAR DE PEDIR o que a fonte já disse que não tem — ver
 * `lerGruposPublicados`. Com o desvio, um dia sem boletim (domingo, feriado, o
 * próprio dia de hoje) custa UMA requisição em vez de quatro.
 *
 * **A data vai em DD/MM/AAAA — o contrário da CEASAMINAS.** Discriminado com um
 * par de datas, não lendo o datepicker: `06/02/2026` (6 de fevereiro, sexta, dia
 * de publicação) devolve 251 linhas e `02/06/2026` (2 de junho, terça) devolve
 * nada. Se fosse MM/DD o resultado seria o inverso.
 *
 * **O "Data:" da tabela é ECO DA ENTRADA, não o que o banco devolveu.** Enviando
 * `cot_data=04/09/2026xyz` a página reimprime `Data: 04/09/2026xyz` e serve as
 * 199 linhas certas de 04/09. Ou seja: comparar esse eco com a data pedida
 * passaria sempre, porque a fonte só devolve o que nós mandamos. O eco continua
 * em `dataDaResposta` (é o que a página informa, como o contrato pede) e é
 * conferido — mas o que essa conferência pega é resposta CRUZADA ou CACHEADA por
 * intermediário, não erro de formato de data. A defesa de verdade, a que
 * corresponde ao desastre que a CEASAMINAS nos deu (200 com o boletim de outro
 * mês), é a lista `var Grupos`, que o servidor renderiza a partir do banco.
 *
 * **A fonte NÃO distingue "dia sem boletim" de "parâmetro inválido".** Dez
 * pedidos diferentes — domingo, feriado, hoje, 31/02, 99/99/9999,
 * `cot_data=abacaxi`, data vazia, `cot_grupo=FOOBAR`, grupo vazio — devolveram
 * 200 com a MESMA página de 65.964 bytes. Comparadas linha a linha, duas dessas
 * respostas diferem em 1 de 658 linhas, e a diferença é o nonce de ofuscação de
 * e-mail do Cloudflare (`data-cfemail`). Consequência direta no desenho: `parse`,
 * que é puro e só vê o corpo, NÃO tem como separar domingo de grupo errado — o
 * máximo honesto que ele declara é `vazio: true`. A separação mora em `buscar`,
 * que conhece a data e o grupo pedidos e cruza os dois com `var Grupos`.
 *
 * **Produto + unidade NÃO identifica a linha.** Nas 199 linhas de FRUTAS,
 * `produto|unidade` dá 111 chaves distintas (88 linhas colidem) e
 * `produto|classificação|unidade` dá 199 — e a colisão é real, não teórica:
 * ABACAXI PÉROLA cotado a 7,34 (8 frutos), 5,38 (10 frutos) e 3,67 (12 frutos).
 * Como `CotacoesImportService.gravar` deduplica por `slug|unidade` antes do
 * `INSERT ... ON CONFLICT`, jogar a classificação fora faria 88 das 199 frutas
 * desaparecerem em silêncio, ficando a última de cada grupo — dado errado com
 * cara de certo, sem alarme nenhum. Por isso a classificação entra no NOME do
 * produto, como a CEASAMINAS já faz ("ALFACE CRESPA PRIMEIRA").
 *
 * **A classe da tabela tem erro de digitação na fonte: `contacao_lista`.** E o
 * parse é escopado a ela de propósito: mais adiante a mesma página traz a tabela
 * do plugin de cookies (7 `<tr class="cookielawinfo-row">` nas 208 `<tr>` da
 * página, contra 201 dentro da tabela do boletim), que contaminaria uma varredura
 * de `<tr>` na página inteira.
 */

const URL_COTACOES = "https://ceagesp.gov.br/cotacoes/";

/**
 * Categorias buscadas quando `sourceParams` não diz nada.
 *
 * As quatro de hortifruti, que é o que o cliente do CeasaPro vende: 428 das 573
 * linhas do dia, em ~7 s em vez de ~12 s. FLORES e PESCADOS existem e funcionam
 * (basta pôr em `sourceParams`), e ORGÂNICOS nunca tem dado — a própria fonte
 * declara `"ORGÂNICOS": null`.
 */
const GRUPOS_PADRAO = ["DIVERSOS", "FRUTAS", "LEGUMES", "VERDURAS"];

/**
 * Nomes das colunas, JÁ NORMALIZADOS por `chave()`.
 *
 * A tabela não tem `<thead>`, nem `id` por célula, nem atributo nenhum que nomeie
 * o campo — nada parecido com o `id_sc_field_<campo>_<linha>` da CEASAMINAS. Os
 * nomes vivem SÓ na linha de cabeçalho. Para cumprir "ancore em nome, nunca em
 * posição", o parser lê o cabeçalho, monta nome → índice e só então indexa as
 * células: a posição passa a ser derivada de cada resposta em vez de constante no
 * código, e uma coluna nova no meio da tabela não embaralha o resultado.
 */
const COL_PRODUTO = "PRODUTO";
const COL_CLASSIFICACAO = "CLASSIFICACAO";
const COL_UNIDADE = "UNI/PESO";
const COL_MENOR = "MENOR";
const COL_COMUM = "COMUM";
const COL_MAIOR = "MAIOR";

/**
 * As colunas de que o parser DEPENDE. Faltar qualquer uma é FALHA, não vazio.
 *
 * "Quilo" (o peso em kg da unidade cotada — ABACAXI PÉROLA 08 FRUTOS, UN, 1,8)
 * de propósito não está aqui: nenhum valor de `LinhaDeCotacao` sai dela, então
 * derrubar a importação inteira por causa dela seria trocar um dado bom por
 * nenhum. A perda dela aparece no fingerprint, que é a camada certa para
 * "mudou e talvez importe".
 */
const COLUNAS_OBRIGATORIAS = [
  COL_PRODUTO,
  COL_CLASSIFICACAO,
  COL_UNIDADE,
  COL_MENOR,
  COL_COMUM,
  COL_MAIOR,
] as const;

/** Erro de digitação da fonte ("contacao"), não meu. Ver cabeçalho. */
const MARCADOR_TABELA = /<table[^>]*class="[^"]*contacao_lista[^"]*"[^>]*>([\s\S]*?)<\/table>/i;

/** A lista de datas com boletim que o servidor renderiza a partir do banco. */
const MARCADOR_GRUPOS = "var Grupos";

/**
 * Página de morte do WordPress.
 *
 * Vem com HTTP 500, então `buscarHtml` já devolve `{ok:false}` antes de `parse`
 * ser chamado — estes marcadores são cinto de segurança para o dia em que a fonte
 * passar a devolver 200 com essa página. O único jeito que encontrei de provocá-la
 * é malformar o NOME do campo (`cot_grupo[]=FRUTAS`, array onde o PHP espera
 * string); data ruim e grupo ruim NÃO produzem erro, caem no caso vazio.
 */
const MARCADORES_DE_ERRO = ["Erro &rsaquo; WordPress", "erro crítico no seu site", "wp-die-message"];

/** A fonte escreve "-" (e não célula vazia) quando o produto não tem classificação: 42 das 199. */
const SEM_CLASSIFICACAO = "-";

/** Datas de publicação de UM grupo, como a fonte as declara em `var Grupos`. */
type DatasDoGrupo =
  /** Lista de datas (ISO) com boletim. */
  | { tipo: "lista"; datas: string[] }
  /** A fonte diz `null` — o grupo não tem publicação nenhuma (é o caso de ORGÂNICOS). */
  | { tipo: "nenhuma" }
  /** A chave existe mas o valor não é algo que eu saiba ler: PEDE, em vez de presumir vazio. */
  | { tipo: "ilegivel" };

interface GruposPublicados {
  /** Chaves na ordem em que a fonte as escreve. Entra no fingerprint. */
  nomes: string[];
  /** Por chave NORMALIZADA (`chave()`), porque a da fonte vem acentuada ("ORGÂNICOS"). */
  datas: Map<string, DatasDoGrupo>;
}

/** O que uma resposta é, depois de lida. `parse` e `buscar` partem daqui. */
type Analise =
  | { tipo: "erro"; erro: string }
  | { tipo: "naoReconhecida"; erro: string }
  | { tipo: "formatoMudou"; erro: string; colunas: string[]; publicados: GruposPublicados }
  | { tipo: "formulario"; publicados: GruposPublicados }
  | {
      tipo: "boletim";
      linhas: LinhaDeCotacao[];
      colunas: string[];
      publicados: GruposPublicados;
      ecoDoGrupo: string | null;
      ecoDaData: string | null;
    };

/**
 * Nome de coluna/grupo em forma comparável: sem acento, maiúsculo, sem sobra de
 * espaço. Serve para "Classificação" casar com a constante e para "ORGÂNICOS" da
 * fonte casar com "ORGANICOS" digitado no `sourceParams` do admin.
 *
 * O nome CRU é que entra no fingerprint — trocar "Classificação" por
 * "Classificacao" não quebra o parser, mas é mudança de formato e o operador tem
 * de saber.
 */
function chave(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim();
}

function textoLimpo(bruto: string): string {
  return bruto
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Número no formato brasileiro — a MESMA regra de `numero()` em
 * `src/lib/cotacoes/csv.ts`: se tem vírgula, ela é o decimal e o ponto é milhar.
 *
 * De propósito NÃO é a `preco()` do `ceasaminas.ts`, que apaga todo ponto: nas
 * 573 linhas medidas não há separador de milhar (o maior valor visto é 250), mas
 * no dia em que a fonte escrever "10.27" aquela regra devolveria 1027 — preço mil
 * vezes maior, gravado sem erro nenhum aparecendo.
 */
function numero(bruto: string): number | null {
  const limpo = bruto.trim().replace(/[R$\s]/g, "");
  if (!limpo) return null;
  const normalizado = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** DD/MM/AAAA — o formato que a fonte espera. Ver cabeçalho. */
function dataParaFonte(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

/** A data pedida chega em meia-noite UTC; o dia civil dela é o que a fonte usa. */
function isoDeUtc(d: Date): string {
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

/**
 * "04/09/2026" → "2026-09-04". Aceita 1 dígito no dia/mês porque a fonte tolera
 * (e reimprime) `4/9/2026`; devolve `null` para qualquer outra coisa em vez de
 * montar uma data inventada — mesmo cuidado de `parseIsoDateTz`, cujo defeito
 * (formato certo, valor impossível) está na auditoria de 2026-09-07.
 */
function isoDeDataBr(bruto: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(bruto.trim());
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const ano = Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  // A volta: se os campos civis não são os que entraram, a data não existe
  // (31/02 vira 03/03 em silêncio).
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    return null;
  }
  return isoDeUtc(d);
}

/**
 * `var Grupos = {"FRUTAS":["26\/08\/2026",...],"ORGÂNICOS":null,...}`
 *
 * ESTE é o sinal de data confiável da CEAGESP: quais datas TÊM boletim, por
 * categoria, renderizado pelo servidor a partir do banco — diferente do "Data:"
 * da tabela, que é só o eco da nossa entrada. Está presente tanto na página de
 * formulário quanto na de resultado (conferido nas duas fixtures), e é o que
 * permite a `buscar`:
 *
 *   - distinguir "domingo" de "grupo escrito errado no `sourceParams`", coisa que
 *     a fonte por si só não distingue;
 *   - não gastar requisição em categoria que a própria fonte diz não ter
 *     publicado naquele dia — o que é o que mantém uma central dentro do
 *     orçamento de 40 s do cron.
 *
 * Ausente ⇒ a resposta não é a página de cotações, e isso é FALHA.
 */
export function lerGruposPublicados(corpo: string): GruposPublicados | null {
  const inicio = corpo.indexOf(MARCADOR_GRUPOS);
  if (inicio < 0) return null;
  const abre = corpo.indexOf("{", inicio);
  const fecha = corpo.indexOf("};", abre);
  if (abre < 0 || fecha < 0) return null;

  let cru: unknown;
  try {
    // JSON válido como está: `\/` e `Â` são escapes que o JSON.parse aceita.
    cru = JSON.parse(corpo.slice(abre, fecha + 1));
  } catch {
    return null;
  }
  if (!cru || typeof cru !== "object" || Array.isArray(cru)) return null;

  const nomes = Object.keys(cru as Record<string, unknown>);
  if (nomes.length === 0) return null;

  const datas = new Map<string, DatasDoGrupo>();
  for (const nome of nomes) {
    const valor = (cru as Record<string, unknown>)[nome];
    if (valor === null) {
      datas.set(chave(nome), { tipo: "nenhuma" });
    } else if (Array.isArray(valor)) {
      const iso = valor
        .filter((v): v is string => typeof v === "string")
        .map((v) => isoDeDataBr(v))
        .filter((v): v is string => v !== null);
      datas.set(chave(nome), { tipo: "lista", datas: iso });
    } else {
      // Valor de forma desconhecida: não presumo vazio (presumir vazio é o jeito
      // de o módulo morrer em silêncio). `buscar` vai pedir o boletim.
      datas.set(chave(nome), { tipo: "ilegivel" });
    }
  }
  return { nomes, datas };
}

/** `<b>Data:</b><span> 04/09/2026</span>` — ECO da entrada. Ver cabeçalho. */
function ecoDaData(corpo: string): string | null {
  const m = /<b>\s*Data:\s*<\/b>\s*<span>\s*([^<]*)<\/span>/i.exec(corpo);
  return m ? isoDeDataBr(m[1]!) : null;
}

/** `<b>Categoria:</b><span> FRUTAS</span>` — também eco. */
function ecoDoGrupo(corpo: string): string | null {
  const m = /<b>\s*Categoria:\s*<\/b>\s*<span>\s*([^<]*)<\/span>/i.exec(corpo);
  const texto = m ? textoLimpo(m[1]!) : "";
  return texto ? texto : null;
}

/** Células de cada `<tr>` da tabela, já em texto limpo. */
function linhasDaTabela(tabela: string): string[][] {
  const linhas: string[][] = [];
  const reLinha = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = reLinha.exec(tabela)) !== null) {
    const celulas: string[] = [];
    // `th` também: se a fonte um dia trocar o cabeçalho de `td` para `th`, o
    // parser continua achando os NOMES das colunas em vez de sumir com tudo.
    const reCelula = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let c: RegExpExecArray | null;
    while ((c = reCelula.exec(m[1]!)) !== null) celulas.push(textoLimpo(c[1]!));
    linhas.push(celulas);
  }
  return linhas;
}

/**
 * PURO: recebe o corpo e diz o que ele é. Sem rede, sem relógio, sem banco.
 * É o que permite testar contra `tests/fixtures/cotacoes/ceagesp-*.html`.
 */
function analisar(corpo: string): Analise {
  const marcador = MARCADORES_DE_ERRO.find((m) => corpo.includes(m));
  if (marcador) {
    return { tipo: "erro", erro: `a fonte devolveu página de erro do WordPress (${marcador})` };
  }

  const publicados = lerGruposPublicados(corpo);
  if (!publicados) {
    // Sem `var Grupos` não é a página de cotações: manutenção, portal, WAF ou o
    // site reformulado. É FALHA, não vazio — chamar de vazio esconderia
    // exatamente a quebra que o alarme existe para pegar, e a tela mostraria
    // "sem boletim hoje" para sempre.
    return { tipo: "naoReconhecida", erro: "resposta não é a página de cotações da CEAGESP" };
  }

  const tabela = MARCADOR_TABELA.exec(corpo);
  if (!tabela) {
    // Página de formulário bem formada, sem tabela de resultado. Pelo CORPO, e
    // só pelo corpo, isto é indistinguível de "pedi um grupo que não existe" —
    // ver cabeçalho. Quem separa é `buscar`.
    return { tipo: "formulario", publicados };
  }

  const linhasCruas = linhasDaTabela(tabela[1]!);
  const iCabecalho = linhasCruas.findIndex((celulas) =>
    celulas.some((c) => chave(c) === COL_PRODUTO),
  );
  if (iCabecalho < 0) {
    return {
      tipo: "formatoMudou",
      erro: "a tabela de cotações veio sem a linha de cabeçalho (nenhuma célula 'Produto')",
      colunas: [],
      publicados,
    };
  }

  const colunas = linhasCruas[iCabecalho]!;
  const indice = new Map<string, number>();
  colunas.forEach((nome, i) => {
    const k = chave(nome);
    if (k && !indice.has(k)) indice.set(k, i);
  });

  const faltando = COLUNAS_OBRIGATORIAS.filter((c) => !indice.has(c));
  if (faltando.length > 0) {
    // Tabela presente mas sem coluna que o parser lê. FALHA: seguir daqui é o
    // caminho para gravar preço de outra coluna com cara de certo.
    return {
      tipo: "formatoMudou",
      erro: `formato mudou: a tabela não tem a(s) coluna(s) ${faltando.join(", ")}`,
      colunas,
      publicados,
    };
  }

  const ultimoNecessario = Math.max(...COLUNAS_OBRIGATORIAS.map((c) => indice.get(c)!));
  const linhas: LinhaDeCotacao[] = [];
  let candidatas = 0;

  for (const celulas of linhasCruas.slice(iCabecalho + 1)) {
    // Uma célula só é linha de título/rodapé com `colspan` (a de "Categoria:
    // FRUTAS  Data: 04/09/2026" é assim), não candidata a cotação.
    if (celulas.length < 2) continue;
    candidatas++;
    if (celulas.length <= ultimoNecessario) continue;

    const em = (col: string) => celulas[indice.get(col)!] ?? "";
    const nome = em(COL_PRODUTO);
    if (!nome) continue;

    const minimo = numero(em(COL_MENOR));
    const comum = numero(em(COL_COMUM));
    const maximo = numero(em(COL_MAIOR));
    // O COMUM é o "valor mais praticado", segundo a própria página; sem ele, o
    // meio da faixa; sem faixa, o que houver. Linha sem preço nenhum não é
    // cotação e sai em silêncio (nas 573 linhas medidas não houve nenhuma, mas é
    // a defesa certa para cabeçalho de grupo).
    const referencia =
      comum ?? (minimo !== null && maximo !== null ? (minimo + maximo) / 2 : (minimo ?? maximo));
    if (referencia === null) continue;

    // A classificação entra no NOME. Ver o cabeçalho: sem ela, 88 das 199 frutas
    // colidem e o gravador em lote descarta a maioria em silêncio.
    const classificacao = em(COL_CLASSIFICACAO);
    const produto =
      classificacao && classificacao !== SEM_CLASSIFICACAO ? `${nome} ${classificacao}` : nome;

    linhas.push({
      produto,
      unidade: em(COL_UNIDADE),
      minimo,
      comum,
      maximo,
      referencia: Math.round(referencia * 100) / 100,
    });
  }

  if (candidatas > 0 && linhas.length === 0) {
    // Tabela com linhas e nenhuma aproveitável. Não é "dia sem boletim": é a
    // fonte tendo mudado o jeito de escrever preço (ou de contar células) sem
    // mudar o nome das colunas. Devolver vazio aqui seria o alarme mentindo.
    return {
      tipo: "formatoMudou",
      erro: `a tabela veio com ${candidatas} linha(s) e nenhuma tinha preço legível`,
      colunas,
      publicados,
    };
  }

  return {
    tipo: "boletim",
    linhas,
    colunas,
    publicados,
    ecoDoGrupo: ecoDoGrupo(corpo),
    ecoDaData: ecoDaData(corpo),
  };
}

/**
 * Assinatura ESTRUTURAL da resposta.
 *
 * Hash dos NOMES de coluna encontrados (em ordem) e das chaves de `var Grupos`.
 * Muda quando a fonte acrescenta, remove, renomeia ou reordena coluna — inclusive
 * quando o parsing continua "funcionando", que é o único caso que nem o erro nem
 * o vazio nem a defasagem pegam.
 *
 * **Nunca hash do corpo.** O nonce `data-cfemail` do Cloudflare muda a cada
 * requisição (foi a ÚNICA diferença entre duas respostas medidas como idênticas),
 * então um hash de conteúdo mudaria em toda execução e o aviso "formato mudou"
 * viraria ruído desde o primeiro dia.
 *
 * As listas de coluna são deduplicadas e ordenadas de propósito: o boletim de um
 * dia vem em 4 a 6 respostas, as categorias não publicam todas nos mesmos dias
 * (FLORES não publicou em 31/08, as outras sim) e a ordem de busca vem do
 * `sourceParams`. Sem dedup, um dia de publicação parcial ou uma troca de
 * configuração mudaria a assinatura sem nada ter mudado na fonte.
 */
function assinatura(listasDeColunas: string[][], nomesDeGrupos: string[]): string {
  const colunas = [...new Set(listasDeColunas.filter((l) => l.length > 0).map((l) => l.join("|")))]
    .sort()
    .join(";");
  const material = `colunas:${colunas}|grupos:${nomesDeGrupos.join("|")}`;
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}

/** `Analise` → o envelope do contrato. */
function parseBoletim(corpo: string): ResultadoDaFonte {
  const a = analisar(corpo);
  switch (a.tipo) {
    case "erro":
    case "naoReconhecida":
      return { ok: false, linhas: [], erro: a.erro };
    case "formatoMudou":
      return {
        ok: false,
        linhas: [],
        erro: a.erro,
        fingerprint: assinatura([a.colunas], a.publicados.nomes),
      };
    case "formulario":
      return {
        ok: true,
        vazio: true,
        linhas: [],
        fingerprint: assinatura([], a.publicados.nomes),
        dataDaResposta: null,
      };
    case "boletim":
      return {
        ok: true,
        vazio: a.linhas.length === 0,
        linhas: a.linhas,
        fingerprint: assinatura([a.colunas], a.publicados.nomes),
        dataDaResposta: a.ecoDaData,
      };
  }
}

/** Lê `{"grupos":[...]}` sem nunca lançar. Ver `GRUPOS_PADRAO` para o porquê do padrão. */
function gruposDe(sourceParams: unknown): string[] {
  const bruto =
    sourceParams && typeof sourceParams === "object"
      ? (sourceParams as { grupos?: unknown }).grupos
      : undefined;
  // Aceita lista ou string separada por vírgula: o campo é um JSON digitado à mão
  // no painel do super-admin, e `"grupos":"FRUTAS,LEGUMES"` é o erro previsível.
  const lista = Array.isArray(bruto)
    ? bruto
    : typeof bruto === "string"
      ? bruto.split(",")
      : [];
  const limpos = lista
    .filter((g): g is string => typeof g === "string")
    .map((g) => chave(g))
    .filter((g) => g.length > 0);
  const unicos = [...new Set(limpos)];
  return unicos.length > 0 ? unicos : [...GRUPOS_PADRAO];
}

/**
 * Vale pedir o boletim deste grupo nesta data?
 *
 * A fronteira desta decisão foi MEDIDA: `var Grupos` lista só as ~5 últimas
 * publicações, e datas ANTERIORES a esse mínimo ainda devolvem boletim (21/08,
 * 19/08, 01/07/2026 e até 05/09/2025 vieram com dados sem estar na lista). Então
 * "não está em Grupos ⇒ vazio" só é sólido para data >= min(Grupos); abaixo disso
 * a ausência é ambígua e o certo é PEDIR — o cron, que busca dias recentes, cai
 * sempre no caso sólido, e a importação manual de uma data antiga não é sabotada
 * por uma otimização.
 */
function vale(
  grupo: string,
  dataIso: string,
  publicados: GruposPublicados,
): { pedir: boolean; publicado: boolean; erro?: string } {
  const d = publicados.datas.get(grupo);
  if (!d) {
    // Não é chave de `var Grupos`: erro de configuração do `sourceParams`, e NÃO
    // "dia sem boletim". Se isto passasse como vazio, uma central mal cadastrada
    // ficaria eternamente "sem boletim hoje", sem alarme — foi exatamente o
    // defeito do `"CEAMG"` gravado no lugar de `214` na CEASAMINAS.
    return {
      pedir: false,
      publicado: false,
      erro: `"${grupo}" não é uma categoria da CEAGESP (a fonte oferece: ${publicados.nomes.join(", ")})`,
    };
  }
  if (d.tipo === "nenhuma") return { pedir: false, publicado: false };
  if (d.tipo === "ilegivel") return { pedir: true, publicado: false };
  if (d.datas.includes(dataIso)) return { pedir: true, publicado: true };
  const menor = d.datas.length > 0 ? d.datas.reduce((a, b) => (a < b ? a : b)) : null;
  return { pedir: menor !== null && dataIso < menor, publicado: false };
}

/**
 * Uma requisição por categoria, sequencial.
 *
 * Sequencial e não em paralelo: quatro requisições simultâneas de um IP de
 * datacenter contra um WordPress atrás de Cloudflare é como se consegue um
 * bloqueio — o mesmo raciocínio da pausa entre centrais em
 * `importarTodasAsCentrais`.
 *
 * **Falha de uma categoria derruba o dia inteiro, de propósito.** Gravar boletim
 * parcial seria pior que não gravar: a tela parte de `MAX(quoteDate)`, então um
 * dia em que só FRUTAS entrou faria LEGUMES e VERDURAS DESAPARECEREM da tela do
 * cliente — sem erro, sem alarme, com cara de boletim novo. Recusar o dia mantém
 * o boletim anterior à vista (com o selo de idade que a tela já mostra) e acende
 * o alarme.
 */
async function buscarBoletim({ sourceParams, data }: ParametrosDeBusca): Promise<ResultadoDaFonte> {
  if (!(data instanceof Date) || Number.isNaN(data.getTime())) {
    return { ok: false, linhas: [], erro: "data inválida" };
  }
  const grupos = gruposDe(sourceParams);
  const dataIso = isoDeUtc(data);
  const cotData = dataParaFonte(data);

  const linhas: LinhaDeCotacao[] = [];
  const listasDeColunas: string[][] = [];
  let publicados: GruposPublicados | null = null;
  let nomesDeGrupos: string[] = [];
  let dataDaResposta: string | null = null;
  let ultimoStatus: number | undefined;

  for (const grupo of grupos) {
    let publicado = false;
    // Na PRIMEIRA volta ainda não se sabe o que a fonte publicou — `var Grupos`
    // chega com a resposta. Custa uma requisição aprender, e é ela que economiza
    // todas as outras.
    if (publicados) {
      const decisao = vale(grupo, dataIso, publicados);
      if (decisao.erro) return { ok: false, linhas: [], erro: decisao.erro };
      if (!decisao.pedir) continue;
      publicado = decisao.publicado;
    }

    const resposta = await buscarHtml(
      URL_COTACOES,
      {
        method: "POST",
        body: new URLSearchParams({ cot_grupo: grupo, cot_data: cotData }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      },
      { fonte: "ceagesp", grupo, data: dataIso },
    );
    if (!resposta.ok) {
      return { ok: false, linhas: [], httpStatus: resposta.status, erro: `${grupo}: ${resposta.erro}` };
    }
    ultimoStatus = resposta.status;

    // `analisar` e não `this.parse`: desestruturar a fonte
    // (`const { buscar } = ceagesp`) deixaria `this` indefinido, e o erro
    // apareceria só em produção, na primeira execução do cron.
    const a = analisar(resposta.corpo);
    if (a.tipo === "erro" || a.tipo === "naoReconhecida" || a.tipo === "formatoMudou") {
      return { ok: false, linhas: [], httpStatus: resposta.status, erro: `${grupo}: ${a.erro}` };
    }

    if (!publicados) {
      publicados = a.publicados;
      nomesDeGrupos = a.publicados.nomes;
      // Confere TODAS as categorias configuradas de uma vez: erro de digitação no
      // `sourceParams` aparece na primeira volta, não depois de meio boletim
      // gravado.
      for (const g of grupos) {
        const decisao = vale(g, dataIso, publicados);
        if (decisao.erro) return { ok: false, linhas: [], erro: decisao.erro };
      }
      publicado = vale(grupo, dataIso, publicados).publicado;
    }

    if (a.tipo === "formulario") {
      if (publicado) {
        // A fonte lista boletim deste grupo nesta data e não entregou a tabela.
        // Não é dia sem boletim: é a fonte se contradizendo, e é quebra.
        return {
          ok: false,
          linhas: [],
          httpStatus: resposta.status,
          erro: `${grupo}: a fonte lista boletim de ${dataIso} e não devolveu a tabela`,
        };
      }
      continue; // dia sem boletim para esta categoria
    }

    // Eco, e o cabeçalho explica que é eco: conferir não pega erro de formato de
    // data (a fonte reimprime o que mandamos, inclusive lixo). Pega resposta
    // CRUZADA ou CACHEADA por intermediário, que é a única forma de vir dado de
    // outro dia/categoria — e essa, se acontecer, grava preço errado em silêncio.
    if (a.ecoDaData && a.ecoDaData !== dataIso) {
      return {
        ok: false,
        linhas: [],
        httpStatus: resposta.status,
        erro: `${grupo}: a resposta traz o boletim de ${a.ecoDaData}, e não de ${dataIso}`,
      };
    }
    if (a.ecoDoGrupo && chave(a.ecoDoGrupo) !== grupo) {
      return {
        ok: false,
        linhas: [],
        httpStatus: resposta.status,
        erro: `${grupo}: a resposta traz a categoria ${a.ecoDoGrupo}`,
      };
    }

    dataDaResposta ??= a.ecoDaData;
    listasDeColunas.push(a.colunas);
    // Sem deduplicar entre categorias: elas não se sobrepõem, e `gravar` já
    // deduplica por `slug|unidade` antes do `INSERT ... ON CONFLICT`.
    linhas.push(...a.linhas);
  }

  return {
    ok: true,
    // Nenhuma categoria com boletim: fim de semana, feriado, ou o dia corrente,
    // que a fonte não serve ("escolha a data anterior ao dia de hoje", diz a
    // própria página; publica seg/qua/sex). O importador recua um dia e tenta de
    // novo, sem alarme — e é por isso que isto NÃO pode virar falha.
    vazio: linhas.length === 0,
    linhas,
    fingerprint: assinatura(listasDeColunas, nomesDeGrupos),
    dataDaResposta,
    httpStatus: ultimoStatus,
  };
}

export const ceagesp: FonteDeCotacao = {
  chave: "ceagesp",
  buscar: buscarBoletim,
  parse: parseBoletim,
};
