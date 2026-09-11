import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Os apelidos de módulo, compartilhados pelos dois projetos.
 *
 * Cada projeto do Vitest resolve o próprio Vite config, então o `alias` precisa
 * ser declarado nos dois — herdar do raiz não acontece. Deixá-lo de fora do
 * projeto `dom` faz todo `import "@/..."` falhar com "failed to resolve", que é
 * um erro que não diz o que houve.
 */
const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
  // `server-only` é resolvido pelo bundler do Next, não existe no Node.
  // Ver o comentário no stub.
  "server-only": fileURLToPath(new URL("./tests/setup/server-only-stub.ts", import.meta.url)),
};

export default defineConfig({
  resolve: { alias },
  test: {
    /*
      Dois projetos, porque as duas metades da suíte têm exigências opostas.

      O `node` fala com o Postgres: precisa das três travas de segurança e roda
      em SÉRIE, porque os arquivos compartilham o mesmo banco. O `dom` monta
      componentes em jsdom, não fala com nada, e pode rodar em paralelo — impor
      a ele a serialização do outro só desperdiça tempo de CI.

      Antes disto não havia projeto `dom` nenhum: `jsdom` e
      `@testing-library/react` não estavam instalados, e por isso NENHUM teste
      de componente era possível no repositório.
    */
    projects: [
      {
        resolve: { alias },
        test: {
          name: "node",
          environment: "node",
          // A ordem importa: o .env e carregado PRIMEIRO (a trava de banco precisa ler o
          // DATABASE_URL dele para recusar um banco que nao seja descartavel), e as travas
          // vem DEPOIS para poderem sobrepor o que ele trouxe — e assim que a trava de
          // e-mail apaga um SMTP configurado no .env do desenvolvedor.
          setupFiles: [
            "dotenv/config",
            "./tests/setup/guard-database.ts",
            "./tests/setup/no-outbound-email.ts",
            "./tests/setup/no-outbound-http.ts",
          ],
          include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
          testTimeout: 30000,
          hookTimeout: 30000,
          fileParallelism: false, // integração usa o mesmo banco — roda arquivos em série
        },
      },
      {
        resolve: { alias },
        test: {
          name: "dom",
          environment: "jsdom",
          /*
            Também carrega a trava de HTTP: componente não deve discar para fora,
            e um `fetch` esquecido dentro de um `useEffect` faria a suíte
            depender de rede sem ninguém perceber. A trava de banco fica de fora
            de propósito — aqui não há Prisma, e ela exigiria um DATABASE_URL
            que este projeto não usa.
          */
          setupFiles: ["./tests/setup/no-outbound-http.ts", "./tests/setup/dom.ts"],
          include: ["tests/component/**/*.test.tsx"],
        },
      },
    ],

    // Os testes E2E (Playwright, *.spec.ts em tests/e2e) NÃO são do Vitest.
    exclude: ["node_modules/**", "tests/e2e/**", ".next/**"],

    /*
      Cobertura: medir para saber onde a rede tem buraco.

      A suíte era grande (mais de mil casos) e ninguém sabia o que ela
      alcança, porque não havia provider instalado. O mapeamento por import
      dizia que 68% dos arquivos nunca eram carregados — mas alcance não é
      cobertura: um arquivo importado pode ter função exportada que nenhum
      teste chama. Só a instrumentação responde isso.

      Fica no raiz, e não dentro de cada projeto: o número que interessa é o da
      união dos dois. Medir separado esconderia justamente o que o projeto `dom`
      veio somar — os `.tsx`, que estavam em 0%.
    */
    coverage: {
      provider: "v8",
      // Sem `all: true`: a opção saiu da API no Vitest 4 e o comportamento
      // virou o padrão — todo arquivo que casa com `include` entra no
      // relatório, tenha teste ou não. É o que impede a cobertura de subir
      // por omissão, contando só o que alguém já se lembrou de testar.
      include: ["src/**/*.{ts,tsx}"],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "./coverage",
      exclude: [
        // Declaração de tipo não tem execução.
        "src/**/*.d.ts",
        /*
          Casca do App Router: `layout.tsx` monta provider e shell, e
          `opengraph-image.tsx` é imagem gerada no build. Não há regra a
          afirmar, e o `next build` já quebra se o tipo estiver errado.
          Ficam de fora para o número não subir por linha sem risco.
        */
        "src/app/**/layout.tsx",
        "src/app/**/opengraph-image.tsx",
        "src/app/**/twitter-image.tsx",
        /*
          Metadados estáticos do Next, consumidos pelo framework e não por
          código nosso. `manifest.ts` é a exceção e continua incluído: ele tem
          teste próprio (`tests/unit/pwa-manifest.test.ts`).
        */
        "src/app/robots.ts",
      ],
      /*
        Sem `thresholds` nesta etapa, de propósito.

        Travar limiar antes de medir escolheria o número pelo que é fácil de
        atingir. Primeiro sai a linha de base real (`docs/11-cobertura.md`),
        depois o limiar entra calibrado acima do medido — e por pasta, alto
        onde a regra de negócio mora.
      */
    },
  },
});
