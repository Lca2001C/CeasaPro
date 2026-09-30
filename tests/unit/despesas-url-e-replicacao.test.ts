import { describe, it, expect } from "vitest";
import { periodoDaUrl, PROXIMOS_DIAS_MAX } from "@/lib/services/despesas.service";
import { mensagemReplicacao } from "@/lib/despesas/replicacao";
import { addDaysTz, isoDateTz, startOfDayTz } from "@/lib/tz";

/**
 * A URL de /despesas é entrada do usuário (link editado, truncado, colado) e ia
 * crua para o `where`: `?de=abc` e `?proximos=1e400` derrubavam a tela com 500
 * em vez de simplesmente ignorar o filtro.
 */
describe("periodoDaUrl", () => {
  const agora = new Date("2026-09-30T15:00:00.000Z");

  it("data válida passa; inválida é descartada", () => {
    expect(periodoDaUrl({ de: "2026-09-01", ate: "2026-09-30" }, agora)).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
      proximos: false,
    });
    for (const ruim of ["abc", "2026-09", "2026-02-31", "25/09/2026", ""]) {
      const p = periodoDaUrl({ de: ruim, ate: ruim }, agora);
      expect(p.from).toBeUndefined();
      expect(p.to).toBeUndefined();
    }
  });

  it("parâmetro repetido (array) não quebra", () => {
    const p = periodoDaUrl({ de: ["2026-09-01", "2026-09-02"] }, agora);
    expect(p.from).toBeUndefined();
  });

  it("`proximos` válido vira janela a partir de hoje", () => {
    expect(periodoDaUrl({ proximos: "7" }, agora)).toEqual({
      from: isoDateTz(startOfDayTz(agora)),
      to: isoDateTz(addDaysTz(agora, 7)),
      proximos: true,
    });
  });

  it("`proximos` absurdo é limitado ou ignorado, nunca Infinity", () => {
    expect(periodoDaUrl({ proximos: "1e400" }, agora).proximos).toBe(false);
    expect(periodoDaUrl({ proximos: "-3" }, agora).proximos).toBe(false);
    expect(periodoDaUrl({ proximos: "abc" }, agora).proximos).toBe(false);
    expect(periodoDaUrl({ proximos: "2.5" }, agora).proximos).toBe(false);
    const teto = periodoDaUrl({ proximos: "100000" }, agora);
    expect(teto.to).toBe(isoDateTz(addDaysTz(agora, PROXIMOS_DIAS_MAX)));
  });
});

describe("mensagemReplicacao", () => {
  it("não diz 'já foram replicadas' quando as contas são recorrentes", () => {
    const m = mensagemReplicacao({ criadas: 0, jaCopiadas: 0, recorrentes: 3 }, "2026-08");
    expect(m).not.toMatch(/replicadas/);
    expect(m).toMatch(/3 é\(são\) automática/);
    expect(m).toMatch(/^Nada a copiar de 2026-08/);
  });

  it("mistura: diz cada grupo", () => {
    const m = mensagemReplicacao({ criadas: 2, jaCopiadas: 1, recorrentes: 1 }, "2026-08");
    expect(m).toMatch(/^2 conta\(s\) copiada\(s\)/);
    expect(m).toMatch(/1 já tinha\(m\) cópia/);
    expect(m).toMatch(/1 é\(são\) automática/);
  });

  it("só já copiadas", () => {
    expect(mensagemReplicacao({ criadas: 0, jaCopiadas: 4, recorrentes: 0 }, "2026-08")).toBe(
      "Nada a copiar de 2026-08: 4 já tinha(m) cópia",
    );
  });
});
