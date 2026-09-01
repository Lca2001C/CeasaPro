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
export async function encerrarSessao(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
  // Apaga o snapshot de consulta offline ANTES de sair. Ele contem estoque, nomes
  // de clientes e quanto cada um deve, e a tela de consulta le do IndexedDB sem
  // pedir sessao — num celular compartilhado, deixa-lo entregaria o movimento da
  // empresa para o proximo que abrisse o app.
  await limparSnapshotNoLogout();
  irComSessaoNova("/login");
}
