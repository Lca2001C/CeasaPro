import { NextRequest } from "next/server";
import { clientIp, userAgent } from "@/lib/http/request";
import {
  clearGoogleOAuthCookie,
  readGoogleOAuthCookie,
} from "@/lib/auth/cookies";
import { abrirSessaoGoogle, resolverLoginGoogle } from "@/lib/services/google-login.service";
import {
  googleOAuthConfig,
  lerEstadoOAuth,
  loginComErroGoogle,
  trocarCodigoPorPerfil,
} from "@/lib/auth/google-oauth";
import { describeError, logger } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * Volta do Google. Sem JavaScript: valida o `state`, troca o code, abre a sessão
 * e redireciona. Qualquer falha cai no login com uma mensagem genérica — o
 * detalhe (code inválido, e-mail sem verificação) não deve virar oráculo.
 *
 * "Qualquer falha" inclui as que LANÇAM: rede caindo no meio da troca do code
 * com o Google (`fetch` rejeita), banco fora ao vincular a conta. Sem o
 * try/catch isso chegava ao navegador como um 500 cru, numa aba que a pessoa
 * abriu clicando num botão da tela de login — sem caminho de volta.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const redirectLogin = (path: string) => Response.redirect(new URL(path, origin));

  try {
    return await concluir(req, redirectLogin);
  } catch (e) {
    logger.error({ err: describeError(e) }, "Falha no retorno do login com Google");
    // O cookie de state é de uso único; se a falha veio antes de apagá-lo, apaga
    // agora. Melhor esforço: o destino é o mesmo login de qualquer jeito.
    await clearGoogleOAuthCookie().catch(() => undefined);
    return redirectLogin(loginComErroGoogle("google-falhou"));
  }
}

async function concluir(
  req: NextRequest,
  redirectLogin: (path: string) => Response,
): Promise<Response> {
  const errorParam = req.nextUrl.searchParams.get("error");
  if (errorParam) {
    await clearGoogleOAuthCookie();
    return redirectLogin(loginComErroGoogle("google-cancelado"));
  }

  const cfg = googleOAuthConfig();
  if (!cfg) {
    await clearGoogleOAuthCookie();
    return redirectLogin(loginComErroGoogle("google-indisponivel"));
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const guardado = await lerEstadoOAuth(await readGoogleOAuthCookie());
  await clearGoogleOAuthCookie();

  if (!code || !state || !guardado || guardado.state !== state) {
    return redirectLogin(loginComErroGoogle("google-falhou"));
  }

  const perfil = await trocarCodigoPorPerfil(cfg, code, guardado.verifier);
  if (!perfil) {
    return redirectLogin(loginComErroGoogle("google-falhou"));
  }

  const ip = await clientIp();
  const resultado = await resolverLoginGoogle(perfil, { ip });
  if (!resultado.ok) {
    return redirectLogin(loginComErroGoogle(resultado.code));
  }

  const sessao = await abrirSessaoGoogle(resultado.userId, resultado.role, {
    ip,
    userAgent: (await userAgent()) ?? undefined,
  });
  if (!sessao) {
    return redirectLogin(loginComErroGoogle("google-falhou"));
  }

  const destino = guardado.next || sessao.redirectTo;
  return redirectLogin(destino);
}
