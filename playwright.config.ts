import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;
const baseURL = `http://localhost:${PORT}`;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1, // banco/tenant compartilhado + rate limit → execução determinística
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL,
    locale: "pt-BR",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    // 1) Faz login uma vez e salva a sessão.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    // 2) Testes que exigem estar logado (empresa demo).
    {
      name: "authed",
      testIgnore: /auth\.(setup|spec)\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: "tests/e2e/.auth/user.json",
      },
    },
    // 3) Testes públicos (sem sessão): login/redirect.
    {
      name: "public",
      testMatch: /auth\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // E2E rodam contra o BUILD DE PRODUÇÃO (rotas pré-compiladas — sem a latência
  // de compilação sob demanda do `next dev`). Rode `npm run build` antes.
  webServer: {
    command: "npm run start",
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
