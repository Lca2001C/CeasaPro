"use client";

import { useEffect } from "react";
import { renovarSessao } from "@/lib/api-client";

/**
 * Mantém a sessão válida enquanto o app está sendo usado.
 *
 * O `apiPost` já renova e repete sozinho quando toma 401, mas metade das telas
 * grava por **server action** (despesas, fornecedores, embalagens, caixas,
 * configurações), e ali não há um `fetch` nosso para interceptar: o proxy
 * responde ao POST da action com um redirecionamento para /login, e o formulário
 * preenchido se perde. Renovar antes de o token vencer resolve os dois caminhos
 * de uma vez, e também evita o incômodo de voltar ao app e cair no login.
 *
 * Duas regras de desenho:
 *
 * 1. **Renova quando a aba volta a ficar visível.** É o gesto de quem retomou o
 *    trabalho — e é o único caminho que funciona no iPhone, onde o iOS congela
 *    os temporizadores da aba em segundo plano. Um intervalo sozinho não
 *    dispararia depois do almoço.
 * 2. **No intervalo, só renova se houve interação.** Sem isso, uma aba aberta e
 *    esquecida ficaria logada indefinidamente, o que é pior do que pedir login
 *    de novo. Quem está digitando uma compra interage; quem saiu, não.
 *
 * A trava por `localStorage` faz as abas cooperarem: como a renovação rotaciona
 * o refresh token, duas abas renovando ao mesmo tempo fariam a segunda usar um
 * token já revogado pela primeira.
 */

const CHAVE_ULTIMA = "sessao-renovada-em";

/** Fração do tempo de vida do token em que a renovação passa a ser permitida. */
const FRACAO_DA_JANELA = 0.6;

function agora(): number {
  return Date.now();
}

function ultimaRenovacao(): number {
  try {
    const bruto = localStorage.getItem(CHAVE_ULTIMA);
    const valor = Number(bruto);
    return Number.isFinite(valor) ? valor : 0;
  } catch {
    // Aba privada / storage bloqueado: sem trava, cada aba se resolve sozinha.
    return 0;
  }
}

function marcarRenovacao() {
  try {
    localStorage.setItem(CHAVE_ULTIMA, String(agora()));
  } catch {
    /* sem storage: a próxima checagem simplesmente tenta de novo */
  }
}

export function SessaoViva({ tokenTtlSegundos }: { tokenTtlSegundos: number }) {
  useEffect(() => {
    // O intervalo real vem do servidor (ACCESS_TOKEN_TTL). Deixar uma constante
    // aqui faria a renovação parar de proteger se alguém encurtasse o TTL, e o
    // defeito voltaria calado.
    const janelaMs = Math.max(60, tokenTtlSegundos) * 1000 * FRACAO_DA_JANELA;

    let interagiu = false;
    const marcarInteracao = () => {
      interagiu = true;
    };

    async function tentar(motivo: "visivel" | "intervalo") {
      if (document.visibilityState !== "visible") return;
      if (motivo === "intervalo" && !interagiu) return;
      if (agora() - ultimaRenovacao() < janelaMs) return;

      // Marca ANTES de chamar: se duas abas passarem pela checagem no mesmo
      // instante, a janela já está tomada e a segunda desiste na próxima volta.
      marcarRenovacao();
      interagiu = false;
      const ok = await renovarSessao();
      if (!ok) {
        // Refresh token inválido (expirou de verdade, ou a conta foi
        // desativada). Não redireciona daqui: interromper alguém no meio de um
        // formulário para mandá-lo ao login perderia o que ele digitou. A
        // próxima gravação recebe a mensagem de sessão expirada.
        try {
          localStorage.removeItem(CHAVE_ULTIMA);
        } catch {
          /* nada a fazer */
        }
      }
    }

    const aoFicarVisivel = () => void tentar("visivel");
    const timer = setInterval(() => void tentar("intervalo"), 60_000);

    document.addEventListener("visibilitychange", aoFicarVisivel);
    window.addEventListener("pointerdown", marcarInteracao, { passive: true });
    window.addEventListener("keydown", marcarInteracao, { passive: true });

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", aoFicarVisivel);
      window.removeEventListener("pointerdown", marcarInteracao);
      window.removeEventListener("keydown", marcarInteracao);
    };
  }, [tokenTtlSegundos]);

  return null;
}
