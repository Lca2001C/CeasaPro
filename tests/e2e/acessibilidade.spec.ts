import { test, expect } from "@playwright/test";
import { varrer, varrerGraves, descrever } from "./_helpers/acessibilidade";

/**
 * Acessibilidade — a varredura que não existia.
 *
 * Antes desta auditoria o projeto tinha `axe-core` apenas como dependência
 * TRANSITIVA do `eslint-config-next`, e nenhuma verificação de acessibilidade
 * de espécie alguma. O que a primeira varredura encontrou, tudo corrigido nos
 * commits desta etapa:
 *
 *  - `maximumScale: 1` no viewport **desligava o zoom por pinça em todas as
 *    páginas** — falha de WCAG 1.4.4, e o público deste app é justamente quem
 *    mais precisa aproximar a tela;
 *  - `--warning` rendia 2,86:1 nos dois sentidos, numa cor cujo único papel é
 *    avisar;
 *  - cinco formulários tinham rótulo na tela mas solto, sem nada ligando texto
 *    e campo: `label` e `select-name` com impacto CRÍTICO, inclusive no ajuste
 *    de estoque e na compra;
 *  - `/assinatura` e as telas de autenticação não tinham marco `<main>`.
 *
 * **Por que o axe, se já existe o `eslint-plugin-jsx-a11y`.** Eles enxergam
 * coisas diferentes e nenhum substitui o outro. O lint lê um arquivo JSX por
 * vez e não segue composição — não vê o par rótulo/campo montado por dois
 * componentes, nem contraste, nem ordem de títulos no documento inteiro. O axe
 * roda na árvore montada e estilizada, que é o que a pessoa recebe.
 */

/** As telas que a suíte varre. Cobre um representante de cada forma de tela. */
const TELAS = [
  // Listas e painéis
  "/dashboard",
  "/produtos",
  "/vendas",
  "/fiado",
  "/estoque",
  "/despesas",
  "/relatorios",
  "/cotacoes",
  "/compras",
  "/caixas-plasticas",
  "/higienizacao",
  "/embalagens",
  // Formulários — onde estavam as violações críticas
  "/produtos/novo",
  "/fornecedores/novo",
  "/fiado/novo",
  "/compras/nova",
  "/despesas/nova",
  "/estoque/ajuste",
  "/caixas-plasticas/novo",
  "/higienizacao/nova",
  // Frente de caixa: a tela que não pode quebrar
  "/vendas/nova",
  // Telas fora do AppShell, que não herdam marco nenhum
  "/assinatura",
  "/alterar-senha",
  "/onboarding",
  // Configuração e ajuda
  "/configuracoes",
  "/plano",
  "/ajuda",
];

test.describe("varredura axe — nenhuma violação séria ou crítica", () => {
  for (const rota of TELAS) {
    test(rota, async ({ page }) => {
      const resposta = await page.goto(rota);
      /*
        Afirma o status antes de varrer. Sem isto, uma rota que passasse a
        responder 404 varreria a página de "não encontrado" — que é acessível —
        e o teste ficaria VERDE anunciando que a tela está boa, quando a tela
        nem existe mais. Foi assim que a sonda descobriu que `/conta` não é uma
        rota.
      */
      expect(resposta?.status(), `${rota} não respondeu 200`).toBe(200);

      const violacoes = await varrerGraves(page);
      expect(violacoes.length, `\n${rota}:\n${descrever(violacoes)}\n`).toBe(0);
    });
  }
});

test.describe("o que a varredura genérica não cobra", () => {
  /*
    O axe verifica regras, não intenções. Os três casos abaixo são decisões
    desta auditoria que uma varredura de regra daria por satisfeita de outras
    formas — então ficam presos aqui, explicitamente.
  */

  test("o primeiro Tab da página oferece pular a navegação", async ({ page }) => {
    /*
      A barra lateral tem 16 itens. Sem este link, quem navega por teclado os
      atravessa TODOS antes de chegar ao conteúdo, em cada troca de tela.

      O teste aperta Tab de verdade em vez de procurar a classe `sr-only`: o
      erro clássico aqui é esconder o link com `display: none`, que o tira
      também da ordem de tabulação e o torna inalcançável — e nesse caso a
      classe continuaria lá, igualzinha.
    */
    await page.goto("/dashboard");
    await page.keyboard.press("Tab");

    const link = page.getByRole("link", { name: /pular para o conteúdo/i });
    await expect(link).toBeFocused();
    // Invisível até aqui, visível agora que tem foco.
    await expect(link).toBeVisible();

    await page.keyboard.press("Enter");
    await expect(page.locator("main#conteudo")).toBeFocused();
  });

  test("a tela atual é anunciada, e não só pintada", async ({ page }) => {
    // Antes, o item ativo do menu era marcado apenas por cor de fundo — o que
    // não chega a quem usa leitor de tela nem a quem não distingue as cores.
    await page.goto("/produtos");

    const ativo = page.locator("aside nav a[aria-current='page']");
    await expect(ativo).toHaveCount(1);
    await expect(ativo).toHaveText(/produtos/i);

    // E muda junto com a navegação, em vez de ficar preso na primeira tela.
    await page.goto("/despesas");
    await expect(page.locator("aside nav a[aria-current='page']")).toHaveText(/despesas/i);
  });

  test("cada navegação tem nome próprio", async ({ page }) => {
    // Com dois `<nav>` sem rótulo o leitor de tela anuncia "navegação" duas
    // vezes, e a lista de marcos deixa de servir para se orientar.
    await page.goto("/dashboard");
    await expect(page.getByRole("navigation", { name: "Menu principal" })).toHaveCount(1);
  });

  test("o zoom por pinça continua permitido", async ({ page }) => {
    /*
      Trava de regressão do defeito mais amplo que esta auditoria achou:
      `maximumScale: 1` no viewport desligava o zoom em todas as páginas.
      É o tipo de linha que volta por conveniência ("o iOS está dando zoom no
      campo") — e a cura certa para isso é fonte de 16px no campo, que já está
      em `Input`, `Select` e `Textarea`.
    */
    await page.goto("/dashboard");
    const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");

    expect(viewport).not.toContain("maximum-scale=1");
    expect(viewport).not.toContain("user-scalable=no");
  });
});

test.describe("no celular, que é onde o app vive", () => {
  test("a frente de caixa a 320px", async ({ page }) => {
    // O PDV é a tela mais densa e a única que não pode falhar. A largura de
    // 320px é o menor celular que ainda aparece no acesso.
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto("/vendas/nova");

    const violacoes = await varrerGraves(page);
    expect(violacoes.length, descrever(violacoes)).toBe(0);
  });

  test("a barra inferior anuncia a tela atual", async ({ page }) => {
    // No celular quem manda é a `BottomNav`, e nenhum spec a exercitava.
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto("/produtos");

    const ativo = page.locator("nav a[aria-current='page']");
    await expect(ativo).toHaveCount(1);
  });

  test("no tablet, a faixa que nenhum teste cobria", async ({ page }) => {
    /*
      768px é exatamente o `md:` em que a barra lateral entra e a inferior sai.
      A suíte só tinha 320px e desktop — a troca acontecia numa faixa que
      ninguém olhava, e é onde as duas poderiam aparecer juntas (ou nenhuma).
    */
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/dashboard");

    await expect(page.locator("aside")).toBeVisible();

    /*
      `getByRole` e não `locator("nav[aria-label=…]")`, e a diferença é o
      ponto do teste.

      As duas barras existem no DOM em qualquer largura — quem as separa é o
      CSS (`md:hidden` numa, `hidden md:block` na outra). O seletor de atributo
      conta as DUAS e falhava aqui; o papel só enxerga o que está na árvore de
      acessibilidade, e `display: none` sai dela.

      Ou seja: é exatamente esta asserção que prova que as duas barras com o
      mesmo rótulo NÃO se sobrepõem para quem usa leitor de tela — que era a
      dúvida ao dar o mesmo nome às duas.
    */
    await expect(page.getByRole("navigation", { name: "Menu principal" })).toHaveCount(1);
    await expect(page.locator("nav[aria-label='Menu principal']")).toHaveCount(2);

    const violacoes = await varrerGraves(page);
    expect(violacoes.length, descrever(violacoes)).toBe(0);
  });
});

test.describe("dívida conhecida, medida e não escondida", () => {
  test("as violações restantes são só moderadas, e estão listadas", async ({ page }) => {
    /*
      O piso de reprovação desta suíte é `serious`. Este caso existe para que o
      que sobra abaixo dele seja CONTADO, e não simplesmente ignorado: se o
      número subir, alguém introduziu algo novo e vai precisar dizer o quê.

      Hoje o dashboard sai limpo. O teto de 2 dá folga para uma regra nova do
      axe aparecer numa atualização sem quebrar o CI — mas não para uma
      degradação de verdade passar despercebida.
    */
    await page.goto("/dashboard");
    const todas = await varrer(page);
    const moderadas = todas.filter((v) => !["serious", "critical"].includes(v.impacto));

    expect(moderadas.length, descrever(moderadas)).toBeLessThanOrEqual(2);
  });
});
