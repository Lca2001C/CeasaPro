import { signAccess } from "@/lib/auth/jwt";
import { buildAccessPayload } from "@/lib/auth/build-session";
import {
  readRefreshCookie,
  setAuthCookies,
  clearAuthCookies,
  marcarTentativaDeRenovacao,
} from "@/lib/auth/cookies";
import { auditarReusoDeSessao, rotateRefreshToken } from "@/lib/auth/refresh";
import { clientIp, userAgent } from "@/lib/http/request";
import { destinoSeguro, ehNavegacaoDeTopo } from "@/lib/auth/renovacao";

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

  // Só navegação de topo — a regra mora em `renovacao.ts`, junto do resto do
  // contrato desta rota, e é EXIGENTE: antes, cabeçalho ausente passava, e a
  // proteção descrita aqui não existia para quem não enviasse Fetch Metadata.
  if (!ehNavegacaoDeTopo(req.headers)) {
    return new Response("forbidden", { status: 403 });
  }

  const atual = await readRefreshCookie();
  if (!atual) return paraLogin();

  const ip = (await clientIp()) ?? undefined;
  const ua = (await userAgent()) ?? undefined;
  const rotated = await rotateRefreshToken(atual, { ip, userAgent: ua });

  if (rotated.tipo === "reuso") {
    await auditarReusoDeSessao(rotated.userId, rotated.familyId, { ip, userAgent: ua });
  }
  // Reuso e inválido levam ao MESMO lugar, de propósito: o atacante não recebe
  // sinal de que foi detectado.
  if (rotated.tipo === "reuso" || rotated.tipo === "invalido") {
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
