/**
 * Peças compartilhadas da renovação de sessão por navegação.
 *
 * Módulo próprio, e não dentro da rota, porque o **proxy** precisa da constante
 * do cookie — e o proxy roda no Edge. Importar a rota de lá arrastaria Prisma e
 * `next/headers` para o bundle do middleware, que não os suporta.
 *
 * Nada aqui toca banco, cookie ou rede: é só nome e regra pura, para poder ser
 * lido dos dois lados e testado sozinho.
 */

import { safeRedirectPath } from "@/lib/safe-redirect";

/**
 * Marca de "acabei de tentar renovar" (trava anti-laço).
 *
 * Se o cookie novo não for aceito na requisição seguinte — relógio fora de hora,
 * cookie descartado por política do navegador — o proxy veria de novo "sem
 * sessão + com refresh token" e mandaria para a renovação outra vez, sem fim.
 * Com esta marca, de vida curta, ele desiste e manda para o login: estado ruim,
 * mas finito.
 */
export const COOKIE_TENTATIVA_RENOVACAO = "cp_renov";

/** Validade da marca. Curta: só precisa cobrir o ida-e-volta do redirecionamento. */
export const TENTATIVA_MAX_AGE_SEGUNDOS = 30;

/**
 * Para onde voltar depois de renovar.
 *
 * Aceita SÓ caminho interno. `//outro.site` é URL protocolo-relativa e o
 * navegador a trataria como domínio externo: deixar passar transformaria a rota
 * de renovação em redirecionamento aberto — útil para phishing exibindo o nosso
 * domínio na barra de endereços.
 *
 * Delega a `safeRedirectPath` porque havia DOIS contratos para o mesmo
 * problema, e este era o fraco: olhava só os dois primeiros caracteres. O
 * valor que ele recebe vem de `searchParams.get("next")` — ou seja, já
 * percent-decodificado — e ia cru para o cabeçalho `Location`. Não achei
 * exploração com o código anterior, mas ter a versão frouxa justamente no
 * caminho de um header não escapado é a condição para o próximo `next=`
 * quebrar.
 *
 * O que se ganha de brinde: `/\golpe.com` passa a ser rejeitado em qualquer
 * posição (não só no começo), `/login` deixa de ser destino válido (fecha um
 * laço possível) e o retorno é `${pathname}${search}${hash}` de uma `URL` já
 * parseada, então CR/LF não sobrevivem.
 *
 * `safe-redirect` é puro (só `URL`), então continua importável pelo proxy no
 * Edge — que é a razão de este módulo existir.
 */
export function destinoSeguro(bruto: string | null | undefined): string {
  return safeRedirectPath(bruto, "/");
}

/**
 * A requisição é uma navegação de topo do próprio navegador?
 *
 * `/api/auth/renovar` é um GET que ROTACIONA o refresh token, e um GET que muda
 * estado pode ser disparado de qualquer site por uma `<img>` ou um `fetch`. Os
 * cabeçalhos de Fetch Metadata separam os casos: só a barra de endereços trocando
 * de página produz `mode: navigate`; uma imagem embutida manda `no-cors`, e um
 * `fetch` manda `cors`.
 *
 * Exige o cabeçalho, em vez de aceitar a ausência. A versão anterior era
 * `if (modo && modo !== "navigate") return 403` — ou seja, cabeçalho AUSENTE
 * passava, e a proteção descrita no comentário simplesmente não existia para
 * quem não o enviasse. Todo navegador que roda este app manda Fetch Metadata
 * desde 2020; quem não manda não tem como usar o sistema mesmo.
 *
 * Só o `mode`, e não o `dest`. Exigir `dest: document` parecia mais estrito e
 * QUEBROU o fluxo real — medindo o que de fato chega aqui quando o proxy desvia
 * uma navegação, o Chromium manda `{mode: "navigate", dest: "empty"}`: o `dest`
 * de documento não sobrevive ao salto do redirecionamento. O `mode` sozinho já
 * separa o que importa, e as chamadas do `api-client` chegam como
 * `{mode: "cors"}` — recusadas, como devem ser.
 */
export function ehNavegacaoDeTopo(cabecalhos: {
  get(nome: string): string | null;
}): boolean {
  return cabecalhos.get("sec-fetch-mode") === "navigate";
}

/**
 * Marca, na URL da renovação, que quem mandou para cá foi um LAYOUT que achou a
 * sessão revogada — não o proxy.
 *
 * A diferença importa para a trava anti-laço. O proxy só desvia quando NÃO há
 * `cp_renov`; o layout desvia com o access cookie ainda válido, e não tem como
 * olhar a marca antes. Se a renovação der certo e o layout recusar de novo (só
 * numa corrida com outra revogação), a segunda passada chega aqui com
 * `cp_renov` já gravado — e aí a rota desiste, apaga os cookies e manda para o
 * login. Sem o parâmetro essa regra valeria para TODA chamada, e o botão
 * "Entrar no CeasaPro" de `/conta/suspensa` (que também aponta para a
 * renovação) deslogaria quem o apertasse até 30 s depois de uma renovação.
 */
export const PARAM_SESSAO_REVOGADA = "revogada";

/**
 * Para onde o layout manda uma sessão que o banco já revogou.
 *
 * É a própria rota de renovação, e isso não é atalho: ela já sabe tentar o
 * refresh token (que quase sempre morreu junto, porque `revokeAllForUser` e
 * `revokeAllForTenant` revogam os dois) e, não dando, APAGAR os cookies antes de
 * mandar ao `/login`. Apagar é o que desfaz o laço — com o access cookie vivo, o
 * proxy devolveria o `/login` para a home, e a home para o layout que recusa.
 *
 * Empresa bloqueada chega a `/conta/suspensa` pelo caminho normal: o login novo
 * emite o token com o status atual, e o proxy desvia a partir dele.
 */
export function rotaDeSessaoRevogada(destino: string): string {
  const q = new URLSearchParams({ next: destinoSeguro(destino), [PARAM_SESSAO_REVOGADA]: "1" });
  return `/api/auth/renovar?${q.toString()}`;
}

/** A requisição à renovação veio de um layout que recusou a sessão? */
export function veioDeSessaoRevogada(params: URLSearchParams): boolean {
  return params.get(PARAM_SESSAO_REVOGADA) === "1";
}
