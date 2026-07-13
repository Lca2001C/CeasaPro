import { describe, it, expect } from "vitest";
import { spreadsheetSafe } from "@/lib/reports/format-cell";

describe("spreadsheetSafe — proteção contra CSV/Excel formula injection", () => {
  it("neutraliza valores que começam com caracteres de fórmula", () => {
    expect(spreadsheetSafe("=1+1")).toBe("'=1+1");
    expect(spreadsheetSafe("+55")).toBe("'+55");
    expect(spreadsheetSafe("-2+3")).toBe("'-2+3");
    expect(spreadsheetSafe("@SUM(A1:A9)")).toBe("'@SUM(A1:A9)");
    expect(spreadsheetSafe('=HYPERLINK("http://mal","x")')).toBe(
      "'=HYPERLINK(\"http://mal\",\"x\")",
    );
  });

  it("não altera valores normais", () => {
    expect(spreadsheetSafe("Tomate")).toBe("Tomate");
    expect(spreadsheetSafe("R$ 1.234,56")).toBe("R$ 1.234,56");
    expect(spreadsheetSafe("Cliente 123")).toBe("Cliente 123");
    expect(spreadsheetSafe("")).toBe("");
  });
});
