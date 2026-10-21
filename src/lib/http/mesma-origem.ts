import { appBaseUrl } from "@/lib/app-url";
import { AppError } from "./app-error";
import { errorResponse } from "./error-response";

const METODOS_SEGUROS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * A escrita veio de uma página DESTE site?
 *
 * O cookie de sessão é `SameSite=Lax`, que já barra o POST de outro site na
 * maioria dos navegadores — mas era a única barreira, e `Lax` não cobre
 * subdomínio irmão nem navegador antigo. Aqui vão mais duas, baratas:
 *  - `Origin`, que o navegador manda em todo POST/PUT/DELETE e a página não
 *    consegue forjar, tem de ser a deste servidor (ou a `APP_URL`). Sem
 *    `Origin` (cliente que não é navegador) não há CSRF a temer.
 *  - corpo JSON exige `Content-Type: application/json`, que um `<form>` de
 *    outro site não consegue enviar sem disparar o preflight de CORS.
 *
 * Usada pelos envelopes de rota (`withTenantRoute`/`withAdminRoute`) e pelas
 * rotas de `/api/auth/*`, que não passam por eles. Sem ela no login, um
 * `<form enctype="text/plain">` de outro site logava o dono do box na conta do
 * atacante (login CSRF), e o de logout deslogava qualquer um.
 */
export function assertMesmaOrigem(req: Request, exigeJson: boolean): void {
  if (METODOS_SEGUROS.has(req.method.toUpperCase())) return;
  const proibido = () =>
    new AppError("ORIGEM_INVALIDA", "Requisição recusada: origem não reconhecida.", 403);
  if (req.headers.get("sec-fetch-site") === "cross-site") throw proibido();
  const origem = req.headers.get("origin");
  if (origem) {
    const aceitas = new Set([new URL(req.url).origin]);
    try {
      aceitas.add(new URL(appBaseUrl()).origin);
    } catch {
      // APP_URL malformada não pode derrubar a escrita do próprio site.
    }
    if (!aceitas.has(origem)) throw proibido();
  }
  if (
    exigeJson &&
    !(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")
  ) {
    throw new AppError("CONTENT_TYPE_INVALIDO", "Envie os dados como JSON.", 415);
  }
}

/** Para rotas sem envelope: a resposta de recusa, ou `null` quando pode seguir. */
export function recusaDeOutraOrigem(req: Request, exigeJson: boolean): Response | null {
  try {
    assertMesmaOrigem(req, exigeJson);
    return null;
  } catch (e) {
    return errorResponse(e);
  }
}
