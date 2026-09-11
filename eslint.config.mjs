import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

/**
 * Acessibilidade no lint, como dependência DIRETA.
 *
 * `eslint-plugin-jsx-a11y` já vinha aqui como transitivo do
 * `eslint-config-next`, mas com apenas 6 das 32 regras ligadas. Depender de
 * transitivo para uma garantia que se quer manter é frágil: no dia em que o
 * `eslint-config-next` mudar a lista, a proteção some sem ninguém decidir isso.
 *
 * Medido antes de ligar: das 32 regras do conjunto recomendado, **30 já
 * passavam limpas**. Só três disparavam, e cada uma está tratada abaixo ou no
 * arquivo. Ligar em `error` não foi uma aposta — foi o retrato.
 *
 * O plugin NÃO é redeclarado: o `eslint-config-next` já o registra, e
 * redeclarar responde `Cannot redefine plugin "jsx-a11y"`. Só as regras entram.
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.tsx"],
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,

      /*
        `no-autofocus` fica DESLIGADA, e isto é dívida registrada, não descuido.

        São 19 usos, e todos têm a mesma forma: o primeiro campo de um
        formulário que a pessoa ABRIU de propósito — a busca do PDV, o primeiro
        campo de um cadastro, o passo do onboarding. Não há nenhum caso de
        roubar o foco no carregamento de página de conteúdo, que é o dano real
        que a regra existe para evitar.

        O público aqui é um comerciante em pé no box, com uma das mãos ocupada,
        num celular. Tirar o autoFocus da busca do PDV custa um toque em cada
        venda — dezenas por dia — para evitar um incômodo que, nesta forma de
        uso, não se materializa.

        A mitigação do que a regra teme entrou junto nesta etapa: título de
        página antes do formulário e link para pular a navegação, para que quem
        usa leitor de tela saiba onde está antes de o foco ir para o campo.
      */
      "jsx-a11y/no-autofocus": "off",
    },
  },
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
