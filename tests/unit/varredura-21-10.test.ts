import { describe, expect, it, vi } from "vitest";
import { chavePorConteudo, type RefDeChave } from "@/lib/idempotencia-cliente";
import { comIdempotencia, ehConflitoDeIdempotencia } from "@/lib/http/idempotencia";
import { semTokenNaUrl } from "@/lib/observabilidade/sentry";
import { dataNaoAntesDoMesPassado, vendaSchema } from "@/lib/validations/venda";
import { compraSchema } from "@/lib/validations/compra";

describe("dataNaoAntesDoMesPassado", () => {
  const agora = new Date("2026-10-21T15:00:00-03:00");

  it("aceita o mês corrente e o mês passado inteiro", () => {
    expect(dataNaoAntesDoMesPassado("2026-10-21", agora)).toBe(true);
    expect(dataNaoAntesDoMesPassado("2026-09-01", agora)).toBe(true);
    expect(dataNaoAntesDoMesPassado("2026-09-30", agora)).toBe(true);
  });

  it("recusa antes do início do mês passado", () => {
    expect(dataNaoAntesDoMesPassado("2026-08-31", agora)).toBe(false);
    expect(dataNaoAntesDoMesPassado("2026-01-10", agora)).toBe(false);
  });

  it("vira o ano: em janeiro, dezembro ainda está aberto", () => {
    const janeiro = new Date("2027-01-05T10:00:00-03:00");
    expect(dataNaoAntesDoMesPassado("2026-12-01", janeiro)).toBe(true);
    expect(dataNaoAntesDoMesPassado("2026-11-30", janeiro)).toBe(false);
  });

  it("vazio e data inválida ficam para as outras regras", () => {
    expect(dataNaoAntesDoMesPassado(null, agora)).toBe(true);
    expect(dataNaoAntesDoMesPassado("", agora)).toBe(true);
    expect(dataNaoAntesDoMesPassado("2026-02-31", agora)).toBe(true);
  });

  it("está ligada nos schemas de lançamento", () => {
    const venda = vendaSchema.safeParse({ saleDate: "2020-01-01" });
    expect(venda.success).toBe(false);
    const msgs = venda.error?.issues.filter((i) => i.path[0] === "saleDate").map((i) => i.message);
    expect(msgs?.some((m) => m.includes("Data muito antiga"))).toBe(true);

    const compra = compraSchema.safeParse({ purchaseDate: "2020-01-01" });
    expect(compra.error?.issues.some((i) => i.path[0] === "purchaseDate")).toBe(true);
  });
});

describe("chavePorConteudo", () => {
  it("mesmo conteúdo reaproveita a chave; conteúdo novo ganha outra", () => {
    const ref: RefDeChave = { current: null };
    const a = chavePorConteudo(ref, { q: 1 });
    expect(chavePorConteudo(ref, { q: 1 })).toBe(a);
    const b = chavePorConteudo(ref, { q: 2 });
    expect(b).not.toBe(a);
    // voltar ao valor antigo depois de editar é OUTRO lançamento
    expect(chavePorConteudo(ref, { q: 1 })).not.toBe(a);
  });
});

describe("comIdempotencia", () => {
  it("sem chave só grava", async () => {
    const buscar = vi.fn();
    expect(await comIdempotencia(undefined, buscar, async () => "novo")).toBe("novo");
    expect(buscar).not.toHaveBeenCalled();
  });

  it("chave já gravada devolve o anterior sem gravar", async () => {
    const gravar = vi.fn(async () => "novo");
    expect(await comIdempotencia("k", async () => "velho", gravar)).toBe("velho");
    expect(gravar).not.toHaveBeenCalled();
  });

  it("corrida: conflito no índice da chave devolve o gravado pelo outro", async () => {
    let chamadas = 0;
    const buscar = async () => (chamadas++ === 0 ? null : "do-outro");
    const conflito = { code: "P2002", meta: { target: ["tenantId", "idempotencyKey"] } };
    expect(
      await comIdempotencia("k", buscar, async () => {
        throw conflito;
      }),
    ).toBe("do-outro");
  });

  it("outro P2002 não vira sucesso", async () => {
    const outro = { code: "P2002", meta: { target: "products_tenantId_name_key" } };
    expect(ehConflitoDeIdempotencia(outro)).toBe(false);
    await expect(
      comIdempotencia("k", async () => null, async () => {
        throw outro;
      }),
    ).rejects.toBe(outro);
  });
});

describe("Sentry: nome do cliente fora da URL", () => {
  it("troca o nome na ficha do cliente", () => {
    expect(semTokenNaUrl("https://x.app/vendas/clientes/maria%20silva?aba=1")).toBe(
      "https://x.app/vendas/clientes/:cliente?aba=1",
    );
    expect(semTokenNaUrl("/clientes/joao")).toBe("/clientes/:cliente");
    expect(semTokenNaUrl("/vendas/nova")).toBe("/vendas/nova");
  });
});
