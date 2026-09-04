import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

/**
 * O guia tem que refletir o PLANO do cliente, não o catálogo do produto.
 *
 * É a única coisa que distingue esta tela de um texto estático, então é o que
 * este teste prova: com o plano completo as áreas opcionais aparecem; trocando
 * para um plano sem módulo nenhum, elas saem do guia e passam a ser listadas
 * como "não incluído". Um guia que explica em detalhe uma tela que a pessoa não
 * consegue abrir faz ela perder tempo procurando o que não existe.
 *
 * Os módulos viajam no JWT, então trocar o plano no banco só vale depois de
 * renovar a sessão — o mesmo caminho que a tela de troca de plano usa em
 * produção.
 */

const prisma = new PrismaClient();

const DEMO = "demo@ceasapro.com.br";
/** Rótulos vindos de `OPTIONAL_MODULES` — as áreas gateadas por plano. */
const AREAS_OPCIONAIS = ["Caixas plásticas", "Higienização", "Venda de embalagens"];

let planoOriginalId = "";
let tenantId = "";

test.beforeAll(async () => {
  const owner = await prisma.user.findFirstOrThrow({
    where: { email: DEMO },
    select: { tenantId: true },
  });
  tenantId = owner.tenantId!;
  const sub = await prisma.tenantSubscription.findUniqueOrThrow({
    where: { tenantId },
    select: { planId: true },
  });
  planoOriginalId = sub.planId;
});

test.afterAll(async () => {
  // Devolve a empresa demo ao plano original: os outros testes E2E contam com
  // os módulos liberados.
  if (tenantId && planoOriginalId) {
    await prisma.tenantSubscription.update({
      where: { tenantId },
      data: { planId: planoOriginalId },
    });
  }
  await prisma.$disconnect();
});

test.describe("Guia de uso (/ajuda)", () => {
  test("Tutorial no topo abre o guia e o tour, fora do menu", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page.locator("aside").getByRole("link", { name: "Como usar" })).toHaveCount(0);

    await page.getByRole("button", { name: "Tutorial" }).click();
    await page.getByRole("menuitem", { name: "Página de uso" }).click();
    await expect(page).toHaveURL(/\/ajuda$/);
    await expect(
      page.getByRole("heading", { name: "Como usar o CeasaPro" }),
    ).toBeVisible();

    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Tutorial" }).click();
    await page.getByRole("menuitem", { name: "Tour guiado" }).click();
    await expect(page.locator(".driver-popover-title")).toHaveText(
      "Vamos dar uma volta pelo sistema",
    );
  });

  test("explica o núcleo e se ajusta ao plano do cliente", async ({ page }) => {
    // ─── 1. Plano completo: o guia mostra tudo ───
    await page.goto("/ajuda");
    // Escopa ao <main>: os titulos das areas coincidem com os links da barra
    // lateral (Produtos, Fiado, Estoque estao nos dois lugares), e sem isto o
    // seletor casa com dois elementos.
    const guia = page.locator("main");
    await expect(guia.getByRole("heading", { name: "Como usar o CeasaPro" })).toBeVisible();

    // Núcleo: sempre presente, independentemente do plano.
    await expect(guia.getByText("Comece por aqui")).toBeVisible();
    // `exact: true` e obrigatorio: `hasText` casa por SUBSTRING e sem acento de
    // caixa, e "Produtos" apareceria tambem nos resumos de Compras e Estoque
    // (os dois mencionam "produto"). O escopo em <main> ja exclui a lateral.
    for (const nucleo of ["Vender (frente de caixa)", "Produtos", "Fiado", "Estoque"]) {
      await expect(guia.getByText(nucleo, { exact: true })).toHaveCount(1);
    }

    // Com o plano padrão (sem features.modules => todos liberados), as áreas
    // opcionais aparecem e não existe bloco de "não incluído".
    for (const area of AREAS_OPCIONAIS) {
      await expect(guia.getByText(area, { exact: true })).toHaveCount(1);
    }
    await expect(guia.getByText("Não incluído no seu plano")).toHaveCount(0);

    // O conteúdo abre sem JavaScript (<details> nativo): o passo a passo do
    // Fiado já está no HTML, mesmo antes de qualquer clique.
    await expect(
      guia.getByText("A conta aparece aqui sozinha quando você vende escolhendo FIADO."),
    ).toBeAttached();

    // ─── 2. Troca para um plano sem módulos opcionais ───
    const basico = await prisma.plan.findFirstOrThrow({
      where: { slug: "basico" },
      select: { id: true },
    });
    await prisma.tenantSubscription.update({
      where: { tenantId },
      data: { planId: basico.id },
    });

    // Os módulos estão no token: sem renovar a sessão, a tela ainda veria o
    // plano antigo. É o mesmo refresh que a troca de plano dispara.
    const refresh = await page.request.post("/api/auth/refresh", { data: {} });
    expect(refresh.ok()).toBeTruthy();

    // ─── 3. O guia encolheu ───
    await page.goto("/ajuda");
    const guiaBasico = page.locator("main");

    // O núcleo continua.
    await expect(
      guiaBasico.getByText("Vender (frente de caixa)", { exact: true }),
    ).toHaveCount(1);

    // As áreas opcionais saíram das seções do guia...
    // As areas saem das SECOES, mas "Caixas plasticas" e "Higienizacao" seguem
    // nomeadas no bloco "nao incluido" — por isso a assercao e sobre o <summary>,
    // nao sobre o texto solto na pagina.
    for (const area of AREAS_OPCIONAIS) {
      await expect(
        guiaBasico.locator("summary").getByText(area, { exact: true }),
      ).toHaveCount(0);
    }
    // ...e agora estão nomeadas como fora do plano, com caminho para contratar.
    await expect(guiaBasico.getByText("Não incluído no seu plano")).toBeVisible();
    await expect(guiaBasico.getByRole("link", { name: "Ver planos" })).toBeVisible();
  });
});
