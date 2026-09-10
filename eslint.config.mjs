import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Saída do relatório de cobertura (`npm run test:coverage`). É código
    // gerado pelo reporter HTML, já ignorado pelo git, e traz um
    // `eslint-disable` próprio que aparecia como aviso — e o CI roda com
    // `--max-warnings=0`.
    "coverage/**",
  ]),
]);

export default eslintConfig;
