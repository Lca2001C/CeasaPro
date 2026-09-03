import { test, expect, type Page } from "@playwright/test";

/**
 * Tour guiado (driver.js).
 *
 * O que este teste prova é o que a tipagem e os testes de unidade não alcançam:
 * que o tour ANDA. Ele atravessa treze rotas e em cada uma precisa achar no DOM
 * o elemento que o roteiro promete — um `data-tour` renomeado numa página não
 * quebra build nem tipo, só faz o balão apontar para o vazio. Aqui isso falha.
 *
 * O percurso está escrito à mão de propósito: é a jornada esperada do produto, e
 * derivá-la do próprio roteiro faria o teste concordar com qualquer reordenação,
 * inclusive a acidental.
 *
 * As asserções de progresso usam `toHaveText`, que re-tenta. Leitura direta com
 * `textContent` corre com a transição do balão, que a biblioteca faz em
 * `requestAnimationFrame` — e produziria falha intermitente.
 */

/** O percurso do plano completo, que é o da empresa demo. */
const PERCURSO = [
  "/dashboard",
  "/produtos",
  "/fornecedores",
  "/compras",
  "/estoque",
  "/vendas",
  "/fiado",
  "/despesas",
  "/caixas-plasticas",
  "/higienizacao",
  "/embalagens",
  "/relatorios",
  "/ajuda",
];

/** Títulos que marcam pontos do roteiro usados como referência nos testes. */
const ABERTURA = "Vamos dar uma volta pelo sistema";
const FIM_DO_INICIO = "Como andar pelo sistema";
const COMECO_DE_PRODUTOS = "Produtos: a base de tudo";

const balao = (page: Page) => page.locator(".driver-popover");
/**
 * O elemento em destaque.
 *
 * O `#driver-dummy-element` sai da conta: é um nó invisível de 0×0 que a
 * biblioteca cria para centralizar o balão de abertura e só remove no fim do
 * capítulo — ele fica marcado como ativo junto com o destaque de verdade.
 */
const destacado = (page: Page) =>
  page.locator(".driver-active-element:not(#driver-dummy-element)");
const titulo = (page: Page) => page.locator(".driver-popover-title");
const proximo = (page: Page) => page.locator(".driver-popover-next-btn");
const anterior = (page: Page) => page.locator(".driver-popover-prev-btn");
const progresso = (page: Page) => page.locator(".driver-popover-progress-text");

const rotaAtual = (page: Page) => new URL(page.url()).pathname;

/**
 * A animação de troca de destaque da biblioteca (400 ms).
 *
 * O driver.js só registra o novo elemento ativo ao fim dela; um clique antes
 * disso deixa a marcação do passo anterior para trás. Para o usuário é
 * inofensivo — a classe não tem aparência e some no fim do tour —, mas um teste
 * que clica em milissegundos acumularia destaques e mediria outra coisa.
 */
const TRANSICAO_MS = 500;

test.describe("Tour guiado", () => {
  test("atravessa todas as telas do plano e termina em Como usar", async ({ page }) => {
    // Treze navegações contra o build de produção: lento por natureza.
    test.setTimeout(180_000);

    await page.goto("/dashboard");

    // ─── O convite é o que faz alguém descobrir que o tour existe ───
    await expect(page.getByText("Primeira vez no CeasaPro?")).toBeVisible();
    await page.getByRole("button", { name: "Começar o tour" }).click();

    // ─── Abertura: balão centralizado, sem destacar nada ───
    await expect(titulo(page)).toHaveText(ABERTURA);

    // O progresso é do tour INTEIRO. Com o contador da biblioteca seria "1 de 6"
    // aqui e "1 de 2" na tela seguinte, porque há um driver.js por tela.
    const texto = (await progresso(page).textContent()) ?? "";
    const total = Number(texto.split(" de ")[1]);
    expect(total, `progresso ilegível: "${texto}"`).toBeGreaterThan(15);
    await expect(progresso(page)).toHaveText(`1 de ${total}`);

    // Aceito o convite, o cartão sai da tela — o balão já fala por ele.
    await expect(page.getByText("Primeira vez no CeasaPro?")).toHaveCount(0);

    // ─── A caminhada ───
    const visitadas: string[] = [];

    for (let passo = 1; passo <= total; passo++) {
      await expect(progresso(page)).toHaveText(`${passo} de ${total}`);

      const rota = rotaAtual(page);
      if (visitadas[visitadas.length - 1] !== rota) visitadas.push(rota);

      // Fora da abertura, todo passo destaca um elemento de verdade e VISÍVEL.
      // Sem esta asserção o balão poderia estar apontando para o nada — ou para
      // a barra de navegação escondida — e o teste passaria.
      if (passo > 1) {
        await expect(destacado(page)).toHaveCount(1);
        await expect(destacado(page)).toBeVisible();
      }

      const rotulo = (await proximo(page).textContent())?.trim();
      await proximo(page).click();

      if (passo === total) {
        expect(rotulo, "o último balão fecha o tour").toBe("Terminar");
        break;
      }
      if (rotulo === "Continuar") {
        // Troca de tela. Esperar a navegação evita ler o balão da tela anterior,
        // que só sai do DOM depois do clique.
        await page.waitForURL((u) => u.pathname !== rota);
      }
      await expect(balao(page)).toBeVisible();
      await page.waitForTimeout(TRANSICAO_MS);
    }

    expect(visitadas).toEqual(PERCURSO);

    // ─── Fim ───
    await expect(balao(page)).toHaveCount(0);
    expect(rotaAtual(page)).toBe("/ajuda");
    await expect(page.getByText(/Tour concluído/)).toBeVisible();

    // O convite não volta: entrar no tour grava a resposta.
    await page.goto("/dashboard");
    await expect(page.getByText("Primeira vez no CeasaPro?")).toHaveCount(0);
  });

  test("Voltar atravessa telas para trás, e o Esc encerra", async ({ page }) => {
    // Entrada por "Como usar": o caminho de quem dispensou o convite ou quer
    // rever o tour depois. Sem ele o tour seria de uso único.
    await page.goto("/ajuda");
    await page.getByRole("button", { name: "Fazer o tour guiado" }).click();

    // O tour começa no Início mesmo tendo sido disparado de outra tela.
    await page.waitForURL("**/dashboard");
    await expect(titulo(page)).toHaveText(ABERTURA);

    // Na abertura não há para onde voltar, e o botão diz isso.
    await expect(anterior(page)).toHaveClass(/driver-popover-btn-disabled/);

    // Avança até a tela seguinte.
    while (rotaAtual(page) === "/dashboard") {
      await proximo(page).click();
      await page.waitForTimeout(TRANSICAO_MS);
    }
    await page.waitForURL("**/produtos");
    await expect(titulo(page)).toHaveText(COMECO_DE_PRODUTOS);

    // Voltar do primeiro balão de uma tela cai no ÚLTIMO da anterior, e não no
    // primeiro — senão seria preciso reler a tela toda para seguir adiante.
    await anterior(page).click();
    await page.waitForURL("**/dashboard");
    await expect(titulo(page)).toHaveText(FIM_DO_INICIO);

    // Esc encerra: quem já entendeu não deve ficar preso até o fim.
    await page.keyboard.press("Escape");
    await expect(balao(page)).toHaveCount(0);

    // E a tela volta a funcionar — nada de overlay ou trava de clique esquecidos.
    await expect(page.getByRole("heading", { name: "Início" })).toBeVisible();
    await page.getByRole("link", { name: "Nova venda" }).click();
    await page.waitForURL("**/vendas/nova");
  });

  test("não entra na frente de caixa", async ({ page }) => {
    // Regra de produto: é a única tela em que pode haver uma venda começada e um
    // cliente esperando. Um balão modal ali atrapalha trabalho em andamento.
    expect(PERCURSO).not.toContain("/vendas/nova");

    await page.goto("/vendas/nova");
    await expect(balao(page)).toHaveCount(0);
    // E o convite só existe no Início: não interrompe quem foi vender.
    await expect(page.getByText("Primeira vez no CeasaPro?")).toHaveCount(0);
  });
});
