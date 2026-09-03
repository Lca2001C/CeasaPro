import * as path from "node:path";
import * as pdfMakeModule from "pdfmake";
import type { Content } from "pdfmake";
import type { TDocumentDefinitions } from "pdfmake/interfaces";
import { formatDate } from "@/lib/format";
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

export async function toPdf(r: ReportResult): Promise<Buffer> {
  configurePdfMake();

  const header = r.columns.map((c) => ({
    text: c.label,
    bold: true,
    alignment: c.align ?? "left",
    fillColor: "#f1f5f9",
  }));

  const body = [
    header,
    ...r.rows.map((row) =>
      r.columns.map((c) => ({
        text: formatCell(row[c.key], c.format),
        alignment: c.align ?? "left",
      })),
    ),
  ];

  if (r.totals) {
    body.push(
      r.columns.map((c) => ({
        text: r.totals![c.key] !== undefined ? formatCell(r.totals![c.key], c.format) : "",
        bold: true,
        alignment: c.align ?? "left",
        fillColor: "#e2e8f0",
      })),
    );
  }

  const content: Content[] = [
    { text: r.title, style: "title" },
    {
      text: `Periodo: ${formatDate(r.period.from)} a ${formatDate(r.period.to)}`,
      style: "meta",
    },
    { text: `Gerado em: ${formatDate(r.generatedAt)}`, style: "meta" },
    { text: " ", margin: [0, 4] },
    {
      table: {
        headerRows: 1,
        widths: r.columns.map(() => "auto"),
        body,
      },
      layout: "lightHorizontalLines",
    },
  ];

  const doc: TDocumentDefinitions = {
    pageSize: "A4",
    pageOrientation: r.columns.length > 5 ? "landscape" : "portrait",
    pageMargins: [24, 24, 24, 28],
    defaultStyle: { fontSize: 8 },
    styles: {
      title: { fontSize: 14, bold: true, margin: [0, 0, 0, 8] },
      meta: { fontSize: 8, color: "#475569", margin: [0, 0, 0, 2] },
    },
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
