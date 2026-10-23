import * as path from "node:path";
import * as pdfMakeModule from "pdfmake";
import type { Content } from "pdfmake";
import type { TDocumentDefinitions } from "pdfmake/interfaces";
import { formatDate } from "@/lib/format";
import { APP_TIME_ZONE } from "@/lib/tz";
import { formatCell } from "./format-cell";
import type { ReportResult } from "./report.types";

/**
 * O `module.exports` do pdfmake É uma instância de classe, e os métodos dela
 * dependem de `this` (`setFonts` faz `this.fonts = fonts`).
 *
 * Com `import * as pdfMake` e `pdfMake.setFonts(...)`, o `this` vira o
 * NAMESPACE do módulo. Sob o bundler do Next isso funciona por acidente — o
 * namespace acaba sendo o próprio `module.exports` —, mas sob ESM nativo
 * (Node, e portanto qualquer teste) o namespace é imutável e a chamada morre
 * com `TypeError: Cannot redefine property: fonts`. Era o que tornava o
 * exportador de PDF impossível de testar.
 *
 * Resolver o `default` primeiro devolve a instância de verdade nos dois mundos:
 * sob ESM o Node sintetiza `default = module.exports`; sob o bundler o
 * namespace já é o próprio objeto e o `??` cai nele.
 */
const pdfMake = ((pdfMakeModule as unknown as { default?: typeof pdfMakeModule }).default ??
  pdfMakeModule) as typeof pdfMakeModule;

let pdfConfigured = false;

/**
 * Paleta do arquivo. O verde é o da marca (o mesmo dos e-mails); o resto são
 * cinzas que saem bem em impressora laser preto e branco — o cabeçalho verde
 * vira cinza escuro com texto branco, e as linhas zebradas continuam legíveis.
 */
const COR = {
  marca: "#1a7a3f",
  texto: "#0f172a",
  suave: "#64748b",
  linha: "#e2e8f0",
  zebra: "#f8fafc",
  total: "#ecfdf3",
  negativo: "#b91c1c",
} as const;

const MARGEM = 36;
/** Largura útil da página A4, em pontos (para a régua do topo). */
const LARGURA_UTIL = { portrait: 595.28 - MARGEM * 2, landscape: 841.89 - MARGEM * 2 };

/**
 * Célula do PDF: como na tela (`formatCell`), mas o vazio fica em BRANCO em vez
 * de "-". Na tabela impressa o traço repetido virava ruído — a linha
 * "Desconto da venda" do comprovante saía como "- - - -".
 */
function celula(v: unknown, format: ReportResult["columns"][number]["format"]): string {
  return v === null || v === undefined || v === "" ? "" : formatCell(v, format);
}

/** O valor de dinheiro é negativo? (Decimal, number ou texto numérico.) */
function negativo(v: unknown): boolean {
  const n = Number(typeof v === "object" && v !== null ? String(v) : v);
  return Number.isFinite(n) && n < 0;
}

function dataHora(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: APP_TIME_ZONE,
  }).format(d);
}

export async function toPdf(r: ReportResult): Promise<Buffer> {
  configurePdfMake();

  // Retrato até 7 colunas (comprovante, extrato, a maioria dos relatórios);
  // paisagem só quando a tabela não caberia em pé.
  const orientacao = r.columns.length > 7 ? "landscape" : "portrait";
  const temTotais = Boolean(r.totals);

  const header = r.columns.map((c) => ({
    text: c.label,
    bold: true,
    color: "#ffffff",
    alignment: c.align ?? "left",
  }));

  const body: Record<string, unknown>[][] = [
    header,
    ...r.rows.map((row) =>
      r.columns.map((c) => ({
        text: celula(row[c.key], c.format),
        alignment: c.align ?? "left",
        ...(c.format === "money" && negativo(row[c.key]) ? { color: COR.negativo } : {}),
      })),
    ),
  ];
  if (r.totals) {
    body.push(
      r.columns.map((c) => ({
        text: r.totals![c.key] !== undefined ? formatCell(r.totals![c.key], c.format) : "",
        bold: true,
        alignment: c.align ?? "left",
      })),
    );
  }

  // A primeira coluna de texto (cliente, produto, descrição) estica e quebra
  // linha; as de número e data ficam do tamanho do conteúdo. Sem coluna de
  // texto, todas dividem a largura.
  const flexivel = r.columns.findIndex((c) => !c.format || c.format === "text");
  const widths = r.columns.map((_, i) => (flexivel === -1 ? "*" : i === flexivel ? "*" : "auto"));

  const linhasDeIdentificacao: Content[] = r.cabecalho?.length
    ? [
        {
          table: {
            widths: ["auto", "*"],
            body: r.cabecalho.map((l) => [
              { text: l.rotulo, color: COR.suave },
              { text: l.valor, bold: true },
            ]),
          },
          layout: {
            hLineWidth: () => 0,
            vLineWidth: () => 0,
            fillColor: () => COR.zebra,
            paddingLeft: () => 8,
            paddingRight: () => 8,
            paddingTop: () => 3,
            paddingBottom: () => 3,
          },
          margin: [0, 0, 0, 12],
        },
      ]
    : [];

  const content: Content[] = [
    {
      columns: [
        {
          text: [
            { text: "Ceasa", color: COR.texto },
            { text: "Pro", color: COR.marca },
          ],
          fontSize: 16,
          bold: true,
        },
        r.empresa
          ? { text: r.empresa, alignment: "right", color: COR.suave, fontSize: 10, margin: [0, 4, 0, 0] }
          : { text: "" },
      ],
    },
    {
      canvas: [
        {
          type: "line",
          x1: 0,
          y1: 0,
          x2: LARGURA_UTIL[orientacao],
          y2: 0,
          lineWidth: 2,
          lineColor: COR.marca,
        },
      ],
      margin: [0, 6, 0, 12],
    },
    { text: r.title, style: "title" },
    {
      columns: [
        // No comprovante a data está no quadro de identificação; o "período"
        // de um dia só repetiria a informação.
        r.cabecalho?.length
          ? { text: "" }
          : {
              text: `Período: ${formatDate(r.period.from)} a ${formatDate(r.period.to)}`,
              style: "meta",
            },
        { text: `Gerado em ${dataHora(r.generatedAt)}`, style: "meta", alignment: "right" },
      ],
      margin: [0, 0, 0, 12],
    },
    ...linhasDeIdentificacao,
    r.rows.length === 0
      ? { text: "Nenhum lançamento no período.", color: COR.suave, italics: true }
      : {
          table: { headerRows: 1, widths, body: body as never },
          layout: {
            hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
              i === 0 || i === node.table.body.length ? 0 : temTotais && i === node.table.body.length - 1 ? 1 : 0.5,
            vLineWidth: () => 0,
            hLineColor: (i: number, node: { table: { body: unknown[] } }) =>
              temTotais && i === node.table.body.length - 1 ? COR.marca : COR.linha,
            fillColor: (i: number, node: { table: { body: unknown[] } }) => {
              if (i === 0) return COR.marca;
              if (temTotais && i === node.table.body.length - 1) return COR.total;
              return i % 2 === 0 ? COR.zebra : null;
            },
            paddingLeft: () => 6,
            paddingRight: () => 6,
            paddingTop: () => 4,
            paddingBottom: () => 4,
          },
        },
  ];

  const doc: TDocumentDefinitions = {
    pageSize: "A4",
    pageOrientation: orientacao,
    pageMargins: [MARGEM, MARGEM, MARGEM, MARGEM + 8],
    defaultStyle: { fontSize: 9, color: COR.texto },
    styles: {
      title: { fontSize: 15, bold: true, margin: [0, 0, 0, 4] },
      meta: { fontSize: 8, color: COR.suave },
    },
    info: { title: r.title, creator: "CeasaPro" },
    footer: (paginaAtual: number, totalDePaginas: number) => ({
      columns: [
        { text: "CeasaPro · gestão do box no CEASA", color: COR.suave },
        {
          text: `Página ${paginaAtual} de ${totalDePaginas}`,
          alignment: "right",
          color: COR.suave,
        },
      ],
      fontSize: 7,
      margin: [MARGEM, 12, MARGEM, 0],
    }),
    content,
  };

  return pdfMake.createPdf(doc).getBuffer();
}

function configurePdfMake() {
  if (pdfConfigured) return;

  const fontDir = path.resolve(
    process.cwd(),
    "node_modules",
    "pdfmake",
    "build",
    "fonts",
    "Roboto",
  );
  const fontPath = (file: string) => path.join(fontDir, file);

  pdfMake.setFonts({
    Roboto: {
      normal: fontPath("Roboto-Regular.ttf"),
      bold: fontPath("Roboto-Medium.ttf"),
      italics: fontPath("Roboto-Italic.ttf"),
      bolditalics: fontPath("Roboto-MediumItalic.ttf"),
    },
  });
  pdfMake.setUrlAccessPolicy(() => false);
  pdfMake.setLocalAccessPolicy((requestedPath) => {
    const resolved = path.resolve(requestedPath);
    return resolved === fontDir || resolved.startsWith(`${fontDir}${path.sep}`);
  });

  pdfConfigured = true;
}
