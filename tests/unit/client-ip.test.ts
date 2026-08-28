import { describe, it, expect } from "vitest";
import { resolveClientIp } from "@/lib/http/request";

/**
 * O IP resolvido aqui é a chave do rate limit das rotas de autenticação e o
 * valor gravado na auditoria. Se o cliente conseguir escolhê-lo, o limite de
 * 5 tentativas de login por 15 minutos deixa de existir (cada tentativa vira uma
 * janela nova) e a trilha de auditoria passa a registrar endereços forjados.
 */
describe("resolveClientIp", () => {
  const REAL = "203.0.113.7";
  const FORJADO = "1.2.3.4";

  it("prefere x-real-ip, que é escrito pelo proxy e não pelo cliente", () => {
    expect(resolveClientIp(REAL, `${FORJADO}, 198.51.100.9`, 1)).toBe(REAL);
  });

  it("NÃO devolve o elemento mais à esquerda do x-forwarded-for", () => {
    // O ponto da correção: a esquerda da cadeia é o que o cliente mandou.
    const ip = resolveClientIp(null, `${FORJADO}, ${REAL}`, 1);
    expect(ip).not.toBe(FORJADO);
    expect(ip).toBe(REAL);
  });

  it("conta os hops a partir da direita", () => {
    const cadeia = `${FORJADO}, 198.51.100.9, ${REAL}, 10.0.0.1`;
    // 1 hop confiável → o último (o que o proxy imediato acrescentou).
    expect(resolveClientIp(null, cadeia, 1)).toBe("10.0.0.1");
    // 2 hops (CDN + proxy) → um antes do último.
    expect(resolveClientIp(null, cadeia, 2)).toBe(REAL);
  });

  it("com um único endereço, devolve esse endereço", () => {
    expect(resolveClientIp(null, REAL, 1)).toBe(REAL);
  });

  it("cadeia mais curta que os hops configurados não devolve undefined", () => {
    // Configuração errada (hops demais) deve degradar para o elemento mais à
    // esquerda, nunca para `undefined` — que viraria a string "undefined" na
    // chave do rate limit e agruparia requisições de origens diferentes.
    expect(resolveClientIp(null, `${FORJADO}, ${REAL}`, 5)).toBe(FORJADO);
  });

  it("ignora espaços e elementos vazios", () => {
    expect(resolveClientIp(null, `  ${FORJADO} , , ${REAL}  ,`, 1)).toBe(REAL);
    expect(resolveClientIp("   ", `${REAL}`, 1)).toBe(REAL);
  });

  it("sem nenhum dos dois cabeçalhos, devolve null", () => {
    expect(resolveClientIp(null, null, 1)).toBeNull();
    expect(resolveClientIp(null, "", 1)).toBeNull();
    expect(resolveClientIp(null, " , , ", 1)).toBeNull();
  });
});
