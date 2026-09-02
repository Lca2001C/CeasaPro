import { describe, it, expect } from "vitest";
import {
  COOKIE_TENTATIVA_RENOVACAO,
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
