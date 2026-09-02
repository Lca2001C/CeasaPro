import { signAccess } from "@/lib/auth/jwt";
import { buildAccessPayload } from "@/lib/auth/build-session";
import {
  readRefreshCookie,
  setAuthCookies,
  clearAuthCookies,
  marcarTentativaDeRenovacao,
} from "@/lib/auth/cookies";
import { rotateRefreshToken } from "@/lib/auth/refresh";
import { clientIp, userAgent } from "@/lib/http/request";
import { destinoSeguro } from "@/lib/auth/renovacao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Renova a sessão numa NAVEGAÇÃO e devolve a pessoa para onde ela ia.
 *
 * Existe porque o proxy não tem como renovar: o refresh token é opaco e sua
 * validação exige o banco, que não está disponível no middleware. Então o proxy
 * manda a navegação para cá (rota Node), esta rota reemite os cookies e
 * redireciona de volta.
 *
 * Sem isso, quem voltava ao app depois de 15 minutos caía no /login mesmo tendo
 * refresh token válido por 30 dias — o "cai toda hora" no celular, onde o Safari
 * mantém a aba aberta por dias.
 *
 * O `/api/auth/refresh` (POST) não serve aqui: navegação é GET, e o retorno
 * precisa ser um redirecionamento, não JSON.
 */

/**
 * Redireciona por caminho RELATIVO, sem montar URL absoluta.
 *
 * `Response.redirect()` exige URL absoluta, e a única origem disponível aqui
 * seria a de `req.url` — que no Next traz o host de *binding* do servidor. Em
 * desenvolvimento isso vira `http://0.0.0.0:3000/...`, endereço que o navegador
 * recusa (`ERR_ADDRESS_INVALID`); em produção seria o host interno, e o cliente
 * acabaria fora do domínio em que está. `Location` relativo é válido (RFC 7231)
 * e o navegador resolve contra a requisição, então funciona igual atrás de
 * proxy, em `www` ou no domínio nu, e em qualquer domínio de preview.
 */
function irPara(caminho: string): Response {
  return new Response(null, { status: 303, headers: { Location: caminho } });
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const destino = destinoSeguro(url.searchParams.get("next"));
  const paraLogin = () => irPara(`/login?next=${encodeURIComponent(destino)}`);

  /**
   * Só navegação de topo.
   *
   * Esta rota ROTACIONA o refresh token, e um GET que muda estado pode ser
   * disparado de qualquer site por uma `<img>`. `Sec-Fetch-Mode: navigate` só
   * aparece quando o próprio navegador está trocando de página — uma imagem
   * embutida manda `no-cors`. O dano possível seria pequeno (rotacionar a
   * sessão de quem já está logado), mas não há razão para aceitá-lo.
   */
  const modo = req.headers.get("sec-fetch-mode");
  if (modo && modo !== "navigate") {
    return new Response("forbidden", { status: 403 });
  }

  const atual = await readRefreshCookie();
  if (!atual) return paraLogin();

  const rotated = await rotateRefreshToken(atual, {
    ip: (await clientIp()) ?? undefined,
    userAgent: (await userAgent()) ?? undefined,
  });
  if (!rotated) {
    // Refresh token inválido de verdade (expirado, revogado, ou já usado).
    await clearAuthCookies();
    return paraLogin();
  }

  const payload = await buildAccessPayload(rotated.userId);
  if (!payload) {
    // Conta desativada ou excluída entre uma coisa e outra.
    await clearAuthCookies();
    return paraLogin();
  }

  const accessToken = await signAccess(payload);
  await setAuthCookies(accessToken, rotated.newToken);

  // Trava anti-laço: se o cookie novo não for aceito na próxima requisição, o
  // proxy desiste de renovar e manda para o login em vez de repetir o desvio.
  await marcarTentativaDeRenovacao();
  return irPara(destino);
}
