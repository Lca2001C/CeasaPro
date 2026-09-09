import { describe, it, expect } from "vitest";
import {
  urlDeDespesas,
  urlDeDespesasSemFiltros,
  type FiltrosDespesa,
} from "@/lib/despesas-filtros-url";

/**
 * A aba não pode se perder quando o usuário refina a busca.
 *
 * A aba **Vencidas** existe para responder "o que está atrasado?", e é o
 * destino dos avisos do painel e do push (`/despesas?vencidas=1`). Ao refinar
 * ali dentro — buscar "luz", escolher a categoria Aluguel, pôr um período —, a
 * URL era reconstruída só com `status=PENDENTE` e o recorte de atraso ia
 * embora. Não dá erro: a lista passa a mostrar TODAS as pendentes, inclusive as
 * que vencem no futuro. O dono do box lê aquilo como "meus atrasados de
 * Aluguel" e liga para o fornecedor por uma conta que ainda não venceu.
 *
 * É o pior tipo de defeito de filtro — o que responde outra pergunta com cara
 * de resposta certa.
 */

const base: FiltrosDespesa = {
  status: "PENDENTE",
  vencidas: false,
  q: "",
  type: "",
  categoryId: "",
  dateField: "dueDate",
  from: "",
  to: "",
};

const params = (url: string) => new URLSearchParams(url.split("?")[1]);

describe("urlDeDespesas", () => {
  it("a aba Vencidas sobrevive à busca", () => {
    const p = params(urlDeDespesas({ ...base, vencidas: true, q: "luz" }));
    expect(p.get("vencidas")).toBe("1");
    expect(p.get("q")).toBe("luz");
    // `status` no lugar de `vencidas` é justamente o que trocava a pergunta.
    expect(p.get("status")).toBeNull();
  });

  it("a aba Vencidas sobrevive a categoria e período", () => {
    const p = params(
      urlDeDespesas({
        ...base,
        vencidas: true,
        categoryId: "cat-1",
        from: "2026-09-01",
        to: "2026-09-30",
      }),
    );
    expect(p.get("vencidas")).toBe("1");
    expect(p.get("categoria")).toBe("cat-1");
    expect(p.get("campo")).toBe("dueDate");
    expect(p.get("de")).toBe("2026-09-01");
    expect(p.get("ate")).toBe("2026-09-30");
  });

  it("as outras abas continuam se identificando por status", () => {
    const p = params(urlDeDespesas({ ...base, status: "PAGO", q: "aluguel" }));
    expect(p.get("status")).toBe("PAGO");
    expect(p.get("vencidas")).toBeNull();
  });

  it("filtro vazio não vira parâmetro vazio na URL", () => {
    const p = params(urlDeDespesas(base));
    expect(p.get("q")).toBeNull();
    expect(p.get("type")).toBeNull();
    expect(p.get("categoria")).toBeNull();
    expect(p.get("campo")).toBeNull();
  });

  it("sempre volta para a primeira página", () => {
    // Refinar com a página 7 na URL mostraria uma lista vazia.
    expect(params(urlDeDespesas({ ...base, q: "x" })).get("pagina")).toBe("1");
  });

  it("só o fim do período também leva o campo de data", () => {
    const p = params(urlDeDespesas({ ...base, to: "2026-09-30" }));
    expect(p.get("campo")).toBe("dueDate");
    expect(p.get("ate")).toBe("2026-09-30");
    expect(p.get("de")).toBeNull();
  });
});

describe("urlDeDespesasSemFiltros", () => {
  it("limpar os filtros não é sair da aba Vencidas", () => {
    const p = params(urlDeDespesasSemFiltros({ status: "PENDENTE", vencidas: true }));
    expect(p.get("vencidas")).toBe("1");
    expect(p.get("status")).toBeNull();
  });

  it("nas outras abas, limpar mantém o status", () => {
    const p = params(urlDeDespesasSemFiltros({ status: "PAGO", vencidas: false }));
    expect(p.get("status")).toBe("PAGO");
  });

  it("sem status nem aba, o padrão é Pendentes", () => {
    expect(params(urlDeDespesasSemFiltros({ status: "", vencidas: false })).get("status")).toBe(
      "PENDENTE",
    );
  });
});
