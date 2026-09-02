import { describe, it, expect } from "vitest";
import { JANELA_ONLINE_MINUTOS, inicioDaJanelaOnline } from "@/lib/auth/presence";

/**
 * Janela de presença.
 *
 * O teste que importa é o de coerência com o `ACCESS_TOKEN_TTL`: a janela tem de
 * ser MAIOR que o TTL do access token, senão quem está usando o sistema sem
 * parar pisca para "offline" no intervalo entre duas renovações da sessão.
 */

describe("janela de presença", () => {
  it("é maior que o TTL do access token (15 min)", () => {
    expect(JANELA_ONLINE_MINUTOS).toBeGreaterThan(15);
  });

  it("é curta o bastante para 'online' significar agora", () => {
    // Uma janela de horas transformaria o indicador em "entrou hoje".
    expect(JANELA_ONLINE_MINUTOS).toBeLessThanOrEqual(30);
  });

  it("o início da janela é o agora menos a janela", () => {
    const agora = new Date("2026-09-02T12:00:00Z");
    expect(inicioDaJanelaOnline(agora).toISOString()).toBe("2026-09-02T11:40:00.000Z");
  });

  it("não depende de estado entre chamadas", () => {
    const agora = new Date("2026-09-02T12:00:00Z");
    expect(inicioDaJanelaOnline(agora).getTime()).toBe(inicioDaJanelaOnline(agora).getTime());
  });
});
