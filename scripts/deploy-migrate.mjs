/**
 * Aplica as migrations pendentes durante o BUILD DE PRODUÇÃO.
 *
 * Existe por causa de uma queda real: o código foi para o ar esperando a coluna
 * `users.emailVerifiedAt` e o banco não a tinha, então todo login respondia 500
 * (`P2022`). A migration existia no repositório — só nunca havia sido aplicada.
 *
 * A causa era estrutural, não esquecimento:
 *  - `build` era `prisma generate && next build`, sem migration nenhuma;
 *  - o único caminho de migration era o job `deploy` do GitHub Actions, que só
 *    roda se o CI passar (estava vermelho) e que, sem o secret `PROD_DIRECT_URL`,
 *    imprimia "pulando migrations" e saía com sucesso;
 *  - a integração Git da Vercel publica independentemente do GitHub Actions,
 *    então o código subia mesmo com o CI vermelho.
 *
 * Resultado: código novo + schema antigo. Rodar a migration aqui elimina a
 * janela — o build falha se a migration falhar, e nenhum deploy sobe com o banco
 * atrasado.
 *
 * Duas regras que este script protege:
 *
 * 1. **Só em produção.** Build de preview não toca o banco de produção. Sem essa
 *    trava, um branch qualquer aplicaria migrations no banco dos clientes.
 * 2. **Nunca pelo pooler.** Migrations exigem conexão direta: com pgbouncer em
 *    modo transaction (o `-pooler` do Neon) elas falham ou travam. Por isso o
 *    alvo é `DIRECT_URL`, não `DATABASE_URL`.
 */
import { execFileSync } from "node:child_process";

const env = process.env.VERCEL_ENV ?? "";

if (env !== "production") {
  // Local, CI e preview: build normal, sem tocar em banco algum.
  console.log(
    `[deploy-migrate] VERCEL_ENV="${env || "(vazio)"}" — não é produção, migrations não aplicadas.`,
  );
  process.exit(0);
}

const direct = process.env.DIRECT_URL;
if (!direct) {
  console.error(
    "[deploy-migrate] DIRECT_URL ausente no ambiente de produção.\n" +
      "  As migrations precisam da connection string DIRETA do Neon (sem `-pooler`).\n" +
      "  Configure DIRECT_URL nas Environment Variables do projeto na Vercel.\n" +
      "  O build está sendo interrompido de propósito: subir o código sem a\n" +
      "  migration deixa a aplicação com schema atrasado e derruba o login.",
  );
  process.exit(1);
}

if (direct.includes("-pooler")) {
  console.error(
    "[deploy-migrate] DIRECT_URL aponta para o host `-pooler` do Neon.\n" +
      "  Migrations não funcionam através do pgbouncer. Use a connection string\n" +
      "  DIRETA (a mesma sem `-pooler`) em DIRECT_URL.",
  );
  process.exit(1);
}

console.log("[deploy-migrate] Produção detectada — aplicando migrations pendentes...");
execFileSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  // O Prisma resolve `url` por DATABASE_URL; em produção ela é a POOLED, que não
  // serve para migration. Aqui as duas apontam para a direta.
  env: { ...process.env, DATABASE_URL: direct },
  shell: process.platform === "win32",
});
console.log("[deploy-migrate] Migrations aplicadas.");
