import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { toExcel } from "@/lib/reports/excel.exporter";
import { toPdf } from "@/lib/reports/pdf.exporter";
import type { ReportResult } from "@/lib/reports/report.types";

/**
 * Os exportadores produzem o ARQUIVO que o cliente baixa, e não tinham teste
 * nenhum — só `spreadsheetSafe` era coberto, isolado da geração.
 *
 * O que isso deixava sem rede de proteção:
 *
 *  - O `toPdf` resolve as fontes Roboto de dentro de `node_modules` numa
 *    configuração preguiçosa. Se esse caminho mudar (ou a pasta não subir para
 *    o servidor), o download vira 500 e ninguém descobre antes do cliente.
 *  - O `exceljs` puxa `uuid` com CVE aberto, e `npm audit fix --force` propõe
 *    voltar para `exceljs@3.4.0` — mudança que quebra a API usada aqui. Sem
 *    teste, a "correção de segurança" passaria no CI e quebraria a exportação.
 *  - A neutralização de fórmula é testada na função, mas ninguém verificava se
 *    ela chega ao arquivo.
 *
 * Por isso as asserções são sobre os BYTES e sobre o arquivo reaberto, não
 * sobre chamadas mockadas.
 */

const relatorio: ReportResult = {
  title: "Relatório de vendas",
  period: { from: new Date("2026-09-01T03:00:00.000Z"), to: new Date("2026-09-30T03:00:00.000Z") },
  generatedAt: new Date("2026-09-30T12:00:00.000Z"),
  columns: [
    { key: "cliente", label: "Cliente" },
    { key: "qtd", label: "Qtd", align: "right", format: "qty" },
    { key: "total", label: "Total", align: "right", format: "money" },
  ],
  rows: [
    { cliente: "Mercadinho A", qtd: 12.5, total: 1234.56 },
    // Nome que o Excel interpretaria como fórmula se entrasse cru.
    { cliente: "=HYPERLINK(\"http://mal\",\"clique\")", qtd: 1, total: 10 },
  ],
  totals: { cliente: "TOTAL", total: 1244.56 },
};

describe("toExcel", () => {
  it("gera um .xlsx de verdade", async () => {
    const buf = await toExcel(relatorio);
    expect(buf.byteLength).toBeGreaterThan(2000);
    // xlsx é um zip: assinatura "PK".
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");
  });

  it("o arquivo reaberto tem título, cabeçalho, linhas e totais", async () => {
    const buf = await toExcel(relatorio);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Relatório");
    expect(ws).toBeDefined();

    // Linha 1 título, 2 período, 3 gerado em, 4 vazia, 5 cabeçalho.
    expect(ws!.getRow(1).getCell(1).value).toBe("Relatório de vendas");
    expect(String(ws!.getRow(2).getCell(1).value)).toContain("Período:");
    expect(ws!.getRow(5).values).toEqual(
      expect.arrayContaining(["Cliente", "Qtd", "Total"]),
    );

    // Primeira linha de dados: dinheiro e quantidade como NÚMERO, com o
    // formato na célula — o contador precisa conseguir usar SOMA.
    expect(ws!.getRow(6).getCell(1).value).toBe("Mercadinho A");
    expect(ws!.getRow(6).getCell(2).value).toBe(12.5);
    expect(ws!.getRow(6).getCell(3).value).toBe(1234.56);
    expect(ws!.getRow(6).getCell(3).numFmt).toContain("#,##0.00");

    // Totais na última linha usada.
    expect(ws!.getRow(ws!.rowCount).getCell(1).value).toBe("TOTAL");
    expect(ws!.getRow(ws!.rowCount).getCell(3).value).toBe(1244.56);
  });

  it("a fórmula chega neutralizada ao arquivo, sem apóstrofo visível", async () => {
    const buf = await toExcel(relatorio);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Relatório")!;

    const celula = ws.getRow(7).getCell(1);
    // O valor é o texto original, como STRING — o apóstrofo gravado no
    // conteúdo aparecia na planilha.
    expect(celula.value).toBe('=HYPERLINK("http://mal","clique")');
    expect(celula.type).toBe(ExcelJS.ValueType.String);
    // Formato "Texto": não vira fórmula nem quando alguém reedita a célula.
    expect(celula.numFmt).toBe("@");
    expect(celula.formula).toBeUndefined();
  });

  it("negativo, vazio e data saem como número, vazio e data — sem \"'-\"", async () => {
    const { Prisma } = await import("@prisma/client");
    const buf = await toExcel({
      ...relatorio,
      columns: [
        { key: "dia", label: "Dia", format: "date" },
        { key: "cliente", label: "Cliente" },
        { key: "resultado", label: "Resultado", align: "right", format: "money" },
        { key: "qtd", label: "Qtd", align: "right", format: "int" },
      ],
      rows: [
        {
          // 22h30 em São Paulo = 01h30 UTC do dia seguinte: a planilha tem de
          // mostrar o dia BRASILEIRO, como a tela e o PDF.
          dia: new Date("2026-09-11T01:30:00.000Z"),
          cliente: null,
          resultado: new Prisma.Decimal("-12.00"),
          qtd: 3,
        },
      ],
      totals: { dia: "TOTAL", resultado: new Prisma.Decimal("-12.00") },
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Relatório")!;
    const linha = ws.getRow(6);

    const dia = linha.getCell(1).value as Date;
    expect(dia).toBeInstanceOf(Date);
    expect(dia.toISOString().slice(0, 10)).toBe("2026-09-10");
    expect(linha.getCell(1).numFmt).toBe("dd/mm/yyyy");
    expect(linha.getCell(2).value).toBeNull();
    expect(linha.getCell(3).value).toBe(-12);
    expect(linha.getCell(4).value).toBe(3);
    // Rótulo numa coluna de data cai para texto.
    expect(ws.getRow(7).getCell(1).value).toBe("TOTAL");
    expect(ws.getRow(7).getCell(3).value).toBe(-12);
  });

  it("relatório sem linhas ainda gera arquivo válido", async () => {
    // Período sem movimento é o caso mais comum de exportação vazia.
    const buf = await toExcel({ ...relatorio, rows: [], totals: undefined });
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");
  });
});

describe("toPdf", () => {
  it("gera um PDF de verdade, com as fontes resolvidas", async () => {
    const buf = await toPdf(relatorio);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buf.byteLength).toBeGreaterThan(1000);
  });

  it("a segunda chamada reaproveita a configuração de fonte", async () => {
    // A configuração é preguiçosa e guardada num módulo; chamar duas vezes já
    // quebrou em versões anteriores do pdfmake.
    const primeiro = await toPdf(relatorio);
    const segundo = await toPdf(relatorio);
    expect(primeiro.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(segundo.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("muitas colunas viram paisagem sem estourar", async () => {
    const largo: ReportResult = {
      ...relatorio,
      columns: Array.from({ length: 9 }, (_, i) => ({ key: `c${i}`, label: `Coluna ${i}` })),
      rows: [Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`c${i}`, `v${i}`]))],
      totals: undefined,
    };
    const buf = await toPdf(largo);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("relatório sem linhas ainda gera PDF válido", async () => {
    const buf = await toPdf({ ...relatorio, rows: [], totals: undefined });
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
