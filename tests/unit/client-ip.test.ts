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

  // Este caso afirmava o oposto — "prefere x-real-ip, que é escrito pelo proxy
  // e não pelo cliente". Era a suposição de implantação que abria o furo: fora
  // da Vercel, `X-Real-IP` é só mais um cabeçalho que o cliente escreve, e
  // confiá-lo primeiro anulava toda a contagem cuidadosa do `x-forwarded-for`
  // logo abaixo.
  it("NÃO deixa o x-real-ip vencer o x-forwarded-for", () => {
    const ip = resolveClientIp(FORJADO, `1.1.1.1, ${REAL}`, 1);
    expect(ip).toBe(REAL);
    expect(ip).not.toBe(FORJADO);
  });

  it("usa o x-real-ip só quando não há x-forwarded-for nenhum", () => {
    // Sem cadeia não há proxy à frente; aí forjar o x-real-ip não dá nada que
    // forjar o x-forwarded-for já não desse.
    expect(resolveClientIp(REAL, null, 1)).toBe(REAL);
    expect(resolveClientIp(REAL, "", 1)).toBe(REAL);
    expect(resolveClientIp(REAL, " , , ", 1)).toBe(REAL);
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
