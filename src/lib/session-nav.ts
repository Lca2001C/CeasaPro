import { limparSnapshotNoLogout } from "@/lib/pwa/offline-store";

/**
 * Navegação que exige um DOCUMENTO NOVO, não uma transição do router.
 *
 * Usada só nos pontos em que o servidor acabou de trocar o cookie de sessão:
 * o logout limpa o cookie, e `/api/auth/refresh` reemite o access token com
 * claims novos (tenantId do ambiente, status da assinatura).
 *
 * Por que não `router.push()`:
 *  - O Router Cache do Next guarda payloads RSC buscados sob a sessão ANTERIOR.
 *    No logout, isso deixa conteúdo protegido voltar pelo botão "voltar"; no
 *    refresh, serve o `/dashboard` que já havia sido prefetchado com o token
 *    antigo — o vai-e-volta sem explicação descrito em `AbrirAmbienteButton`.
 *  - `push()` + `refresh()` também não resolve: o refetch RSC concorrente
 *    cancela o push ("Failed to fetch RSC payload"), o mesmo problema anotado
 *    em `(auth)/alterar-senha`.
 *
 * Um carregamento de documento descarta o cache inteiro do cliente e força o
 * proxy a reavaliar a sessão do zero — que é exatamente o que se quer aqui.
 *
 * Sobre o lint: a regra `@next/next/no-location-assign-relative-destination`
 * reconhece destino LITERAL, então ela não dispara aqui, onde o destino é
 * parâmetro. Isso não é um truque para calar a regra — é o efeito de concentrar
 * num único lugar a decisão que antes estava espalhada em cinco. A regra
 * continua valendo em todo o resto do código, que é onde ela deve pegar
 * `window.location` usado por engano; qualquer chamada nova de recarga deve
 * passar por aqui e justificar o motivo.
 */
export function irComSessaoNova(destino: string): void {
  window.location.assign(destino);
}

/**
 * Encerra a sessão no servidor e recarrega em `/login` com documento novo.
 *
 * Estava duplicada em três componentes (`LogoutButton`, `AppShell`,
 * `AdminShell`) — três cópias da mesma decisão de segurança é uma a mais do que
 * o necessário para uma delas divergir sem ninguém notar.
 */
/** O que aconteceu na saída — a mensagem existe só quando algo falhou. */
export interface ResultadoSaida {
  ok: boolean;
  mensagem?: string;
}

export async function encerrarSessao(): Promise<ResultadoSaida> {
  // Sem rede, isto REJEITAVA e derrubava o resto da função.
  //
  // O `fetch` falha no box com sinal ruim — que é o cenário para o qual o PWA
  // existe — e o service worker não intercepta POST. Todos os chamadores usam
  // `void encerrarSessao()`, e não há handler de `unhandledrejection` no
  // projeto: a rejeição morria em silêncio. O usuário tocava em "Sair", a tela
  // não mudava, nenhuma mensagem aparecia — e ele ia embora achando que saiu,
  // com o snapshot de consulta (estoque, nomes de clientes e quanto cada um
  // deve) ainda gravado no aparelho, legível em /consulta-offline sem sessão.
  let servidorOk = true;
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    servidorOk = false;
  }

  // Apaga o snapshot de consulta offline SEMPRE, com ou sem rede: é o dado que
  // fica no aparelho, e num celular compartilhado entre dois boxes é o que
  // entregaria o movimento da empresa para o próximo que abrisse o app.
  let localOk = true;
  try {
    await limparSnapshotNoLogout();
  } catch {
    localOk = false;
  }

  if (!servidorOk) {
    // Não navega: o cookie é httpOnly e continua válido, então ir para /login
    // faria o proxy devolver a pessoa ao sistema — com cara de botão quebrado.
    // Melhor dizer a verdade do que fingir que saiu.
    return {
      ok: false,
      mensagem: localOk
        ? "Sem internet: apagamos os dados de consulta deste aparelho, mas a " +
          "sessão só será encerrada quando a internet voltar. Tente de novo lá."
        : "Sem internet, e não foi possível apagar os dados de consulta deste " +
          "aparelho. Tente sair de novo quando a internet voltar.",
    };
  }

  irComSessaoNova("/login");
  return { ok: true };
}
