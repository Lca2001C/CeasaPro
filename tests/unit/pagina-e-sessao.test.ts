import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * `requirePagina` e `requireTenant` — o gate de LEITURA das telas.
 *
 * Os wrappers de escrita já tinham teste depois desta auditoria
 * (`with-action.test.ts`, `with-route.test.ts`). Estes dois cobrem o outro
 * lado: quem decide se a pessoa pode VER a tela.
 *
 * `tests/unit/paginas-module-gate.test.ts` já existia e é complementar, não
 * redundante: ele lê o FONTE dos layouts e confere que cada módulo pago tem um
 * arquivo chamando `requirePagina` com a chave certa. Ou seja, prova que a
 * função é chamada. Aqui se prova o que ela FAZ quando chamada — e as duas
 * coisas quebram separadamente.
 *
 * A distinção que mais importa está fixada abaixo: `requirePagina` REDIRECIONA,
 * enquanto os wrappers LANÇAM. Um `ForbiddenError` num Server Component cai no
 * error boundary e vira tela de erro genérica; quem não contratou o módulo tem
 * de chegar à tela de planos, não a um "algo deu errado".
 */

const requireTenant = vi.fn();
const redirect = vi.fn((destino: string) => {
  // O `redirect` do Next lança para interromper o render. Reproduzir isso é o
  // que permite afirmar que o código PARA ali — se ele apenas registrasse a
  // intenção e seguisse, a tela renderizaria o conteúdo protegido assim mesmo.
  const e = new Error(`NEXT_REDIRECT:${destino}`);
  (e as Error & { digest: string }).digest = `NEXT_REDIRECT;replace;${destino}`;
  throw e;
});

vi.mock("next/navigation", () => ({ redirect: (d: string) => redirect(d) }));
vi.mock("@/lib/auth/session", () => ({ requireTenant: () => requireTenant() }));

const { requirePagina } = await import("@/lib/auth/pagina");

function sessao(over: Record<string, unknown> = {}) {
  return {
    sub: "user-1",
    role: "OWNER",
    tenantId: "empresa-A",
    email: "dono@box.com",
    name: "Dono",
    tenantStatus: "ACTIVE",
    subStatus: "ATIVO",
    modules: ["caixas", "cotacoes"],
    mustChangePassword: false,
    ...over,
  };
}

/** Executa e devolve para onde redirecionou, ou `null` se passou. */
async function destinoDe(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    const m = /^NEXT_REDIRECT:(.+)$/.exec((e as Error).message);
    if (!m) throw e;
    return m[1]!;
  }
}

beforeEach(() => {
  requireTenant.mockResolvedValue({ session: sessao(), tenantId: "empresa-A" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("requirePagina — assinatura", () => {
  it("empresa com assinatura suspensa vai para /conta/suspensa", async () => {
    requireTenant.mockResolvedValue({
      session: sessao({ subStatus: "SUSPENSO" }),
      tenantId: "empresa-A",
    });

    expect(await destinoDe(() => requirePagina())).toBe("/conta/suspensa");
  });

  it("empresa bloqueada pelo admin também", async () => {
    requireTenant.mockResolvedValue({
      session: sessao({ tenantStatus: "BLOCKED" }),
      tenantId: "empresa-A",
    });
    expect(await destinoDe(() => requirePagina())).toBe("/conta/suspensa");
  });

  it("`permiteInativo` deixa ver a tela de regularização", async () => {
    // Mesma razão do `allowInactive` em `with-route`: quem está bloqueado é
    // exatamente quem precisa abrir a tela para pagar.
    requireTenant.mockResolvedValue({
      session: sessao({ subStatus: "SUSPENSO" }),
      tenantId: "empresa-A",
    });

    expect(await destinoDe(() => requirePagina({ permiteInativo: true }))).toBeNull();
  });

  it("trial e vencido continuam vendo as telas", async () => {
    for (const subStatus of ["TRIAL", "ATIVO", "VENCIDO"]) {
      requireTenant.mockResolvedValue({ session: sessao({ subStatus }), tenantId: "empresa-A" });
      expect(await destinoDe(() => requirePagina()), subStatus).toBeNull();
    }
  });
});

describe("requirePagina — módulo pago", () => {
  it("módulo fora do plano leva à tela de planos, dizendo qual foi", async () => {
    /*
      O destino carrega `?bloqueado=<modulo>` de propósito: a tela de planos usa
      isso para destacar o que a pessoa tentou abrir. Sem o parâmetro ela chega
      numa lista e tem de adivinhar o que faltava.
    */
    const destino = await destinoDe(() => requirePagina({ modulo: "higienizacao" }));
    expect(destino).toBe("/plano?bloqueado=higienizacao");
  });

  it("módulo contratado passa", async () => {
    expect(await destinoDe(() => requirePagina({ modulo: "cotacoes" }))).toBeNull();
  });

  it("é fail-closed: sessão sem a lista de módulos não vê módulo pago", async () => {
    requireTenant.mockResolvedValue({
      session: sessao({ modules: undefined }),
      tenantId: "empresa-A",
    });
    expect(await destinoDe(() => requirePagina({ modulo: "cotacoes" }))).toBe(
      "/plano?bloqueado=cotacoes",
    );
  });

  it("a assinatura é conferida ANTES do módulo", async () => {
    /*
      Quem está com a mensalidade vencida E sem o módulo tem de cair na tela de
      suspensão, não na de planos: contratar um módulo novo não resolve a
      pendência, e mandá-lo comprar mais é o pior atendimento possível.
    */
    requireTenant.mockResolvedValue({
      session: sessao({ subStatus: "SUSPENSO", modules: [] }),
      tenantId: "empresa-A",
    });

    expect(await destinoDe(() => requirePagina({ modulo: "caixas" }))).toBe("/conta/suspensa");
  });
});

describe("requirePagina — o que devolve quando passa", () => {
  it("devolve a sessão e o tenantId da sessão", async () => {
    const r = await requirePagina();
    expect(r.tenantId).toBe("empresa-A");
    expect(r.session.sub).toBe("user-1");
  });

  it("propaga o erro de `requireTenant` sem transformar em redirect", async () => {
    // Sem sessão, quem redireciona para o login é o proxy. Engolir o erro aqui
    // faria a página renderizar sem sessão nenhuma.
    const { UnauthorizedError } = await import("@/lib/http/app-error");
    requireTenant.mockRejectedValue(new UnauthorizedError());

    await expect(requirePagina()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("REDIRECIONA em vez de lançar AppError — a diferença para os wrappers", async () => {
    /*
      Fixa a decisão explicada no doc-comment de `pagina.ts`. Se alguém trocar
      o `redirect` por `throw new ForbiddenError` para "uniformizar" com
      `requireModule`, o cliente sem o módulo passa a ver a tela de erro
      genérica do error boundary em vez da tela de planos.
    */
    const { AppError } = await import("@/lib/http/app-error");
    requireTenant.mockResolvedValue({ session: sessao({ modules: [] }), tenantId: "empresa-A" });

    const erro = await requirePagina({ modulo: "caixas" }).catch((e) => e);

    expect(erro).not.toBeInstanceOf(AppError);
    expect((erro as Error).message).toContain("NEXT_REDIRECT");
  });
});
