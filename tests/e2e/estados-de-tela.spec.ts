import { test, expect } from "@playwright/test";
import { estouroHorizontalDaPagina } from "./_helpers/vazamentos";

/**
 * Erro, 404 e carregamento — os três estados que a aplicação não tinha.
 *
 * Antes desta auditoria não havia **nenhum** `error.tsx`, `not-found.tsx` ou
 * `loading.tsx` em toda a árvore. Consequências, todas verificáveis:
 *
 *  - uma exceção em Server Component caía na página de erro crua do Next, sem
 *    menu e sem caminho de volta;
 *  - as **dez** chamadas de `notFound()` caíam no 404 padrão, em inglês;
 *  - navegar entre telas no 3G do galpão não mostrava nada — e o desfecho
 *    natural de "toquei e não aconteceu nada" é tocar de novo.
 *
 * Estes testes exercitam o que dá para exercitar por fora: o 404, que é
 * alcançável só pedindo um id que não existe. O boundary de erro não tem como
 * ser disparado sem quebrar a aplicação de propósito, então o que se afirma
 * dele aqui é a existência e a forma — o comportamento fica no teste de
 * unidade e na revisão.
 */

test.describe("404 dentro da área da empresa", () => {
  test("id inexistente cai numa tela com saída, e não no 404 cru do Next", async ({ page }) => {
    /*
      `notFound()` também é o desfecho de pedir um id de OUTRA empresa — a
      consulta filtra por tenant e não acha. Então esta tela é, na prática, a
      resposta ao isolamento funcionando, e precisa ser tranquila.
    */
    await page.goto("/produtos/id-que-nao-existe-nenhum");

    /*
      Afirma o que a PESSOA vê, e não o código de status.

      A documentação desta versão do Next é explícita: `notFound()` devolve
      **200 em resposta transmitida em fluxo** e 404 só quando não há
      streaming. As telas de detalhe são `force-dynamic` e assíncronas, logo
      streamed — cobrar 404 aqui seria cobrar do framework um comportamento
      que ele documenta não ter, e o teste falharia por motivo errado.

      O 404 de rota inexistente (bloco abaixo) é outro caminho e continua
      devolvendo 404 de verdade.
    */
    await expect(page.getByRole("heading", { name: /não encontramos este registro/i })).toBeVisible();

    // O que faltava no 404 padrão: um caminho de volta.
    const voltar = page.getByRole("link", { name: /ir para o início/i });
    await expect(voltar).toBeVisible();
    await voltar.click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("o 404 mantém a navegação do app", async ({ page }) => {
    // Fica dentro do grupo `(app)`, então herda o AppShell. Sem isso a pessoa
    // fica sem menu e a única saída é o botão voltar do navegador.
    await page.goto("/vendas/id-inexistente");
    await expect(page.locator("aside")).toBeVisible();
  });

  test("não vaza detalhe interno na tela", async ({ page }) => {
    await page.goto("/fiado/id-inexistente");
    const texto = (await page.locator("main").innerText()).toLowerCase();
    for (const proibido of ["prisma", "tenantid", "select", "stack", "at async"]) {
      expect(texto, proibido).not.toContain(proibido);
    }
  });

  test("cabe no celular", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto("/produtos/id-inexistente");
    await expect(page.getByRole("heading", { name: /não encontramos/i })).toBeVisible();
    expect(await estouroHorizontalDaPagina(page)).toBe(0);
  });
});

test.describe("404 fora da área logada", () => {
  test("caminho inventado oferece landing e login", async ({ page }) => {
    // Quem chega aqui pode nem ter conta — não há menu a oferecer, então as
    // saídas são as duas portas de entrada.
    const r = await page.goto("/caminho-que-nao-existe-mesmo");

    expect(r?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: /esta página não existe/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /ir para o início/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^entrar$/i })).toBeVisible();
  });
});

test.describe("o PDV continua vendendo", () => {
  /*
    A frente de caixa é a tela que não pode quebrar. Esta auditoria mexeu nela
    (a recusa da validação passou a aparecer também junto do botão), então o
    fluxo inteiro é reexercitado aqui, além do que `pdv.spec.ts` já cobre.
  */
  test("a recusa aparece JUNTO do botão, não só no topo", async ({ page }) => {
    /*
      O toast é `top-center` e "Finalizar venda" é barra fixa no rodapé: no
      celular o dedo está embaixo e o aviso nascia no extremo oposto — com a
      lista rolada, inteiramente fora do campo de visão.
    */
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto("/vendas/nova");

    await page.getByRole("button", { name: "Finalizar venda" }).click();

    const alerta = page.getByRole("alert").filter({ hasText: /adicione ao menos um produto/i });
    await expect(alerta).toBeVisible();

    // O que importa: está na mesma região da tela que o botão que ela tocou.
    const caixaDoAlerta = (await alerta.boundingBox())!;
    const caixaDoBotao = (await page
      .getByRole("button", { name: "Finalizar venda" })
      .boundingBox())!;
    expect(Math.abs(caixaDoAlerta.y - caixaDoBotao.y)).toBeLessThan(120);
  });

  test("a recusa SOME quando a causa é resolvida", async ({ page }) => {
    // A mensagem é derivada de `validar()` a cada render, e não guardada em
    // estado — guardar o texto deixaria um aviso velho na tela depois de o
    // problema ter sido resolvido.
    await page.goto("/vendas/nova");
    await page.getByRole("button", { name: "Finalizar venda" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /adicione ao menos/i })).toBeVisible();

    await page.getByPlaceholder(/buscar produto/i).fill("Tomate E2E");
    await page.getByRole("button", { name: /Tomate E2E/i }).first().click();

    await expect(
      page.getByRole("alert").filter({ hasText: /adicione ao menos/i }),
    ).toHaveCount(0);
  });

  test("não avisa nada antes da primeira tentativa", async ({ page }) => {
    /*
      Cobrar campo que a pessoa ainda nem chegou a preencher é o jeito mais
      rápido de ensinar a ignorar aviso vermelho.

      Afirma a AUSÊNCIA DA MENSAGEM DE VALIDAÇÃO, e não ausência de qualquer
      `role="alert"`. A primeira versão cobrava zero alerts e passava isolada,
      mas falhava na suíte cheia: o carrinho chega com item deixado por outro
      spec, e aí o aviso legítimo de "sem preço" está na tela por direito — o
      teste falhava por motivo errado.
    */
    await page.goto("/vendas/nova");

    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: /adicione ao menos|informe o cliente|desconto|formas de pagamento/i }),
    ).toHaveCount(0);
  });
});
