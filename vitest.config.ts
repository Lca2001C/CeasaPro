import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    // A ordem importa: o .env e carregado PRIMEIRO (a trava de banco precisa ler o
    // DATABASE_URL dele para recusar um banco que nao seja descartavel), e as travas
    // vem DEPOIS para poderem sobrepor o que ele trouxe — e assim que a trava de
    // e-mail apaga um SMTP configurado no .env do desenvolvedor.
    setupFiles: [
      "dotenv/config",
      "./tests/setup/guard-database.ts",
      "./tests/setup/no-outbound-email.ts",
    ],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false, // integração usa o mesmo banco — roda arquivos em série
    // Os testes E2E (Playwright, *.spec.ts em tests/e2e) NÃO são do Vitest.
    exclude: ["node_modules/**", "tests/e2e/**", ".next/**"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` é resolvido pelo bundler do Next, não existe no Node.
      // Ver o comentário no stub.
      "server-only": fileURLToPath(
        new URL("./tests/setup/server-only-stub.ts", import.meta.url),
      ),
    },
  },
});
