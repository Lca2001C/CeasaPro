import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { detectarFormato, IMAGEM_MAX_BYTES, prefixoDaEmpresa } from "@/lib/imagem/formato";
import { nivelEstoque } from "@/lib/estoque/nivel";
import { situacaoDaCompra } from "@/lib/despesas/situacao-compra";

/**
 * Foto de produto: o tipo vem dos BYTES (o bucket é público — um "image/png"
 * que é HTML viraria página servida do nosso domínio de fotos), e o R2 só é
 * chamado com as cinco variáveis configuradas.
 */

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);

describe("detectarFormato", () => {
  it("reconhece JPEG, PNG e WebP pelos primeiros bytes", () => {
    expect(detectarFormato(bytes(0xff, 0xd8, 0xff))?.ext).toBe("jpg");
    expect(detectarFormato(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))?.ext).toBe(
      "png",
    );
    const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
    expect(detectarFormato(webp)?.contentType).toBe("image/webp");
  });

  it("recusa o que não é foto, mesmo que o nome diga que é", () => {
    expect(detectarFormato(new TextEncoder().encode("<html><script>"))).toBeNull();
    expect(detectarFormato(new TextEncoder().encode("GIF89a"))).toBeNull();
    expect(detectarFormato(new Uint8Array())).toBeNull();
  });

  it("o teto é de 1 MB e o prefixo separa a empresa", () => {
    expect(IMAGEM_MAX_BYTES).toBe(1024 * 1024);
    expect(prefixoDaEmpresa("t1")).toBe("tenants/t1/produtos/");
  });
});

describe("nivelEstoque com alerta do produto", () => {
  it("usa o mínimo do produto quando existe (chegar nele já é acabando)", () => {
    expect(nivelEstoque(10, 10)).toBe("acabando");
    expect(nivelEstoque(11, 10)).toBe("ok");
    expect(nivelEstoque(3, 2)).toBe("ok"); // abaixo do padrão 5, acima do do produto
  });

  it("sem mínimo, cai no padrão; zerado continua zerado", () => {
    expect(nivelEstoque(4, null)).toBe("acabando");
    expect(nivelEstoque(0, 10)).toBe("zerado");
  });
});

describe("situacaoDaCompra", () => {
  const agora = new Date("2026-10-16T15:00:00Z");
  it("lê a conta da compra", () => {
    expect(situacaoDaCompra(null, agora)).toBe("SEM_CONTA");
    expect(situacaoDaCompra({ status: "PAGO", dueDate: null }, agora)).toBe("PAGA");
    expect(
      situacaoDaCompra({ status: "PENDENTE", dueDate: new Date("2026-10-20T12:00:00Z") }, agora),
    ).toBe("A_PAGAR");
    expect(
      situacaoDaCompra({ status: "PENDENTE", dueDate: new Date("2026-10-10T12:00:00Z") }, agora),
    ).toBe("VENCIDA");
  });
});

describe("R2", () => {
  const ENV = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    process.env = { ...ENV };
    vi.unstubAllGlobals();
  });

  it("sem as variáveis: não configurado, sem URL e o envio falha com 503", async () => {
    delete process.env.R2_BUCKET;
    const r2 = await import("@/lib/storage/r2");
    expect(r2.r2Configurado()).toBe(false);
    expect(r2.publicUrl("catalogo/x.webp")).toBeNull();
    await expect(r2.putObject("x", new Uint8Array([1]), "image/webp")).rejects.toMatchObject({
      status: 503,
    });
  });

  it("com as variáveis: PUT assinado no bucket e URL pública sem barra dupla", async () => {
    Object.assign(process.env, {
      R2_ACCOUNT_ID: "conta",
      R2_ACCESS_KEY_ID: "chave",
      R2_SECRET_ACCESS_KEY: "segredo",
      R2_BUCKET: "fotos",
      R2_PUBLIC_URL: "https://fotos.exemplo.com/",
    });
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r2 = await import("@/lib/storage/r2");

    expect(r2.publicUrl("tenants/t1/produtos/a.webp")).toBe(
      "https://fotos.exemplo.com/tenants/t1/produtos/a.webp",
    );
    await r2.putObject("tenants/t1/produtos/a.webp", new Uint8Array([1, 2]), "image/webp");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const req = (fetchMock.mock.calls[0] as unknown[])[0] as Request;
    expect(req.method).toBe("PUT");
    expect(req.url).toBe("https://conta.r2.cloudflarestorage.com/fotos/tenants/t1/produtos/a.webp");
    expect(req.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256/);
    expect(req.headers.get("content-type")).toBe("image/webp");
  });
});
