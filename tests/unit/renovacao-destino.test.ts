import { describe, it, expect } from "vitest";
import {
  COOKIE_TENTATIVA_RENOVACAO,
  ehNavegacaoDeTopo,
  TENTATIVA_MAX_AGE_SEGUNDOS,
  destinoSeguro,
} from "@/lib/auth/renovacao";

/**
 * A rota de renovação recebe o destino pela URL e redireciona para lá. Isso é
 * exatamente a forma de um **redirecionamento aberto**: se qualquer valor fosse
 * aceito, um link `https://ceasapro.com.br/api/auth/renovar?next=https://golpe.com`
 * levaria o cliente para o site do atacante exibindo o NOSSO domínio no link que
 * ele clicou — que é o material de um phishing convincente.
 *
 * Por isso `destinoSeguro` é função pura e testada em separado: é uma decisão de
 * segurança pequena o bastante para caber num teste e grande o bastante para
 * custar caro se estiver errada.
 */

describe("destinoSeguro — o que passa", () => {
  it("aceita caminho interno", () => {
    expect(destinoSeguro("/compras/nova")).toBe("/compras/nova");
    expect(destinoSeguro("/dashboard")).toBe("/dashboard");
  });

  it("preserva a query, que faz parte de onde a pessoa estava", () => {
    expect(destinoSeguro("/despesas?filtro=PENDENTE&q=luz")).toBe(
      "/despesas?filtro=PENDENTE&q=luz",
    );
  });
});

describe("destinoSeguro — o que é recusado", () => {
  it("recusa URL absoluta", () => {
    expect(destinoSeguro("https://golpe.com/login")).toBe("/");
    expect(destinoSeguro("http://golpe.com")).toBe("/");
  });

  it("recusa URL protocolo-relativa (o caso que engana quem só checa a barra)", () => {
    // `//golpe.com` COMEÇA com "/", então uma checagem ingênua o aprovaria — e o
    // navegador o trata como domínio externo.
    expect(destinoSeguro("//golpe.com")).toBe("/");
    expect(destinoSeguro("//golpe.com/pagina")).toBe("/");
  });

  it("recusa a variante com barra invertida", () => {
    // Alguns navegadores normalizam `/\` para `//`.
    expect(destinoSeguro("/\\golpe.com")).toBe("/");
  });

  it("recusa esquemas perigosos", () => {
    expect(destinoSeguro("javascript:alert(1)")).toBe("/");
    expect(destinoSeguro("data:text/html,<script>")).toBe("/");
  });

  it("recusa caminho relativo (não começa com barra)", () => {
    expect(destinoSeguro("compras/nova")).toBe("/");
  });

  it("trata ausência como raiz", () => {
    expect(destinoSeguro(null)).toBe("/");
    expect(destinoSeguro(undefined)).toBe("/");
    expect(destinoSeguro("")).toBe("/");
  });
});

describe("trava anti-laço", () => {
  it("tem nome próprio, separado dos cookies de sessão", () => {
    expect(COOKIE_TENTATIVA_RENOVACAO).toBe("cp_renov");
  });

  it("dura pouco: só o suficiente para o ida-e-volta do redirecionamento", () => {
    // Longa demais, ela impediria a renovação legítima da navegação seguinte e
    // o usuário voltaria a cair no login.
    expect(TENTATIVA_MAX_AGE_SEGUNDOS).toBeGreaterThan(0);
    expect(TENTATIVA_MAX_AGE_SEGUNDOS).toBeLessThanOrEqual(60);
  });
});

describe("destinoSeguro herdou o contrato robusto (regressao)", () => {
  // O contrato fraco olhava so os DOIS primeiros caracteres. Estes casos
  // passavam por ele e iam crus para o cabecalho Location.
  it("recusa barra invertida em qualquer posicao, nao so no comeco", () => {
    expect(destinoSeguro("/x/\\golpe.com")).toBe("/");
    expect(destinoSeguro("/despesas\\@golpe.com")).toBe("/");
  });

  it("recusa /login como destino (fecha um laco possivel)", () => {
    expect(destinoSeguro("/login")).toBe("/");
    expect(destinoSeguro("/login/entrar")).toBe("/");
  });

  it("devolve caminho normalizado por URL, entao CR/LF nao sobrevivem", () => {
    const destino = destinoSeguro("/despesas\r\nX-Injetado: 1");
    expect(destino).not.toMatch(/[\r\n]/);
  });

  it("preserva query e fragmento de um destino legitimo", () => {
    expect(destinoSeguro("/despesas?filtro=PENDENTE#topo")).toBe(
      "/despesas?filtro=PENDENTE#topo",
    );
  });
});

describe("ehNavegacaoDeTopo exige Fetch Metadata (regressao)", () => {
  const cabecalhos = (m: Record<string, string>) => ({
    get: (n: string) => m[n] ?? null,
  });

  // A versao anterior era `if (modo && modo !== "navigate") return 403`: o
  // cabecalho AUSENTE passava, e a protecao descrita no comentario da rota
  // simplesmente nao existia para quem nao enviasse Fetch Metadata.
  it("cabecalho ausente NAO passa mais", () => {
    expect(ehNavegacaoDeTopo(cabecalhos({}))).toBe(false);
  });

  it("navegacao de topo passa", () => {
    expect(
      ehNavegacaoDeTopo(
        cabecalhos({ "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" }),
      ),
    ).toBe(true);
  });

  // Medido no fluxo real: quando o proxy desvia uma navegacao para esta rota, o
  // Chromium manda dest "empty", nao "document" — o dest de documento nao
  // sobrevive ao salto do redirecionamento. Exigi-lo quebrava a renovacao por
  // navegacao, que e a razao de a rota existir.
  it("navegacao seguindo redirecionamento passa, mesmo com dest empty", () => {
    expect(
      ehNavegacaoDeTopo(cabecalhos({ "sec-fetch-mode": "navigate", "sec-fetch-dest": "empty" })),
    ).toBe(true);
  });

  it("imagem embutida (no-cors) nao passa", () => {
    expect(
      ehNavegacaoDeTopo(cabecalhos({ "sec-fetch-mode": "no-cors", "sec-fetch-dest": "image" })),
    ).toBe(false);
  });

  it("chamada do api-client (cors) nao passa", () => {
    expect(
      ehNavegacaoDeTopo(cabecalhos({ "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" })),
    ).toBe(false);
  });
});
