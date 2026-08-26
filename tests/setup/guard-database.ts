/**
 * Trava de segurança: a suíte de integração escreve e APAGA dados reais
 * (tenants, usuários, planos, cobranças). Ela só pode rodar contra um banco
 * descartável.
 *
 * Existe porque o `.env` do desenvolvedor é o mesmo arquivo usado para apontar
 * scripts pontuais ao banco de produção (reset de senha, conferência de dados).
 * Basta esquecer de voltar a URL para que `npm test` passe a limpar tabelas do
 * Neon — e o primeiro sinal disso seria o cliente ligando.
 *
 * Para rodar contra um banco remoto de propósito (uma cópia de teste, por
 * exemplo), defina `ALLOW_REMOTE_TEST_DB=1`.
 */
import { beforeAll, expect } from "vitest";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "db", "postgres"]);

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Só o que a trava precisa ler — deixa o teste montar um ambiente mínimo.
 * O índice aberto é o que torna `process.env` (ProcessEnv) atribuível aqui.
 */
export interface DbGuardEnv {
  DATABASE_URL?: string;
  ALLOW_REMOTE_TEST_DB?: string;
  [key: string]: string | undefined;
}

export function assertBancoDeTesteSeguro(env: DbGuardEnv = process.env): void {
  if (env.ALLOW_REMOTE_TEST_DB === "1") return;

  const url = env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL não definida. Os testes de integração precisam de um banco local descartável.",
    );
  }

  const host = hostOf(url);
  if (!host) {
    throw new Error(`DATABASE_URL inválida (host não reconhecido): não vou rodar os testes.`);
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      [
        "",
        "  A suíte de testes APAGA dados e o DATABASE_URL não é local.",
        `  Host configurado: ${host}`,
        "",
        "  Aponte o .env para o Postgres local antes de rodar os testes.",
        "  Se este banco remoto é realmente descartável, use ALLOW_REMOTE_TEST_DB=1.",
        "",
      ].join("\n"),
    );
  }
}

/**
 * Só os testes de integração tocam o banco — os unitários continuam rodando
 * com qualquer `.env` (inclusive nenhum), que é o que permite usá-los como
 * verificação rápida enquanto o `.env` aponta para outro lugar.
 */
beforeAll(() => {
  const testPath = expect.getState().testPath ?? "";
  if (!testPath.replace(/\\/g, "/").includes("/tests/integration/")) return;
  assertBancoDeTesteSeguro();
});
