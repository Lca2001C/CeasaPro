import { describe, it, expect } from "vitest";
import { config } from "@/proxy";

/**
 * O `matcher` do proxy decide o que passa pelo middleware — e o que passa por
 * fora dele NÃO recebe CSP, nem gate de sessão, de papel, de assinatura ou de
 * módulo. Uma regex frouxa aqui desliga a borda inteira para os caminhos que
 * ela solta, em silêncio.
 *
 * Não havia teste nenhum sobre ela. Este arquivo existe por causa de dois furos
 * reais, ambos por falta de âncora:
 *
 *  - `.*\.(?:png|…)` sem `$`, com `.` casando `/`: qualquer caminho CONTENDO
 *    `.png` saía do middleware — `/higienizacao/x.png`, `/api/vendas.png/criar`;
 *  - `favicon.ico`, `icons` e `sw.js` testados como prefixo: `/icons-secretos`
 *    e `/sw.js/x` também saíam.
 */

/** O matcher é uma regex de caminho inteiro (sem a sintaxe `:param`). */
const regex = new RegExp(`^${config.matcher[0]}$`);
const passaPeloProxy = (caminho: string) => regex.test(caminho);

describe("matcher do proxy — o que DEVE passar pelo middleware", () => {
  const protegidos = [
    "/",
    "/dashboard",
    "/login",
    "/admin",
    "/api/vendas",
    "/vendas/nova",
    "/sitemap.xml",
    "/robots.txt",
    "/conta/suspensa",
  ];
  for (const caminho of protegidos) {
    it(caminho, () => expect(passaPeloProxy(caminho)).toBe(true));
  }
});

describe("matcher do proxy — as regressões dos dois furos", () => {
  // Cada linha aqui passa hoje e voltaria a falhar se alguém reintroduzisse a
  // exclusão genérica por extensão, ou tirasse as âncoras dos literais.
  const eramBypass = [
    "/dashboard.png",
    "/higienizacao/abc.png",
    "/fiado/abc.png",
    "/api/vendas.png/criar",
    "/admin/empresas/x.png",
    "/api/reports/x.png/export",
    "/sw.js/x",
    "/favicon.ico/x",
    "/icons-secretos/lista",
    "/manifestXwebmanifest",
    "/_nextfoo",
  ];
  for (const caminho of eramBypass) {
    it(caminho, () => expect(passaPeloProxy(caminho)).toBe(true));
  }
});

describe("matcher do proxy — o que legitimamente fica de fora", () => {
  const estaticos = [
    "/_next/static/chunks/main.js",
    "/_next/image",
    // O handshake do WebSocket do HMR: interceptá-lo devolvia 307 e quebrava o
    // dev server com ERR_INVALID_HTTP_RESPONSE.
    "/_next/webpack-hmr",
    "/icons/icon-192.png",
    "/splash/apple-splash-1170-2532.png",
    "/favicon.ico",
    "/manifest.webmanifest",
    "/sw.js",
  ];
  for (const caminho of estaticos) {
    it(caminho, () => expect(passaPeloProxy(caminho)).toBe(false));
  }
});
