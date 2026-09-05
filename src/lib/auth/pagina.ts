import "server-only";
import { redirect } from "next/navigation";
import { requireTenant, type Session } from "./session";
import { accessDecision } from "@/lib/billing/status";
import { isModuleEnabled, type OptionalModuleKey } from "@/lib/plan/modules";

/**
 * Guarda de PÁGINA da área da empresa: sessão + assinatura + módulo do plano.
 *
 * Por que existe. Os wrappers de escrita (`withTenantAction`, `withTenantRoute`)
 * já faziam defesa em profundidade: cada um refaz por conta própria a checagem
 * de assinatura e de módulo, sem depender do middleware. As PÁGINAS não faziam.
 * `(app)/layout.tsx` verificava sessão, troca de senha, tenant e onboarding — e
 * parava aí; `caixas-plasticas`, `higienizacao` e `embalagens` chamavam só
 * `requireTenant()`. O único lugar que decidia assinatura e módulo para
 * navegação era `src/proxy.ts`.
 *
 * Isso amarra a leitura de dado do tenant a UMA camada. Qualquer coisa que faça
 * a requisição escapar do middleware — e o `matcher` já tinha um furo desses,
 * corrigido nesta mesma auditoria — descobria justamente as telas de módulo
 * pago e as de empresa com assinatura bloqueada.
 *
 * O padrão certo já existia em `relatorios/[tipo]/page.tsx`, que checa o módulo
 * no próprio servidor. Isto o generaliza.
 *
 * REDIRECIONA, não lança. Um `ForbiddenError` num Server Component cai no error
 * boundary e vira tela de erro genérica; o proxy redireciona, e a experiência
 * tem de continuar a mesma. É a diferença entre esta função e `requireModule`,
 * que é para wrapper e segue lançando.
 */
export async function requirePagina(opts?: {
  /** Exige que o plano inclua este módulo. */
  modulo?: OptionalModuleKey;
  /**
   * Deixa passar mesmo com a assinatura bloqueada.
   *
   * Só para as telas de regularização — as mesmas que o proxy lista em
   * `BILLING_SAFE_PREFIXES`. Fora delas, empresa bloqueada não lê dado.
   */
  permiteInativo?: boolean;
}): Promise<{ session: Session; tenantId: string }> {
  const { session, tenantId } = await requireTenant();

  if (!opts?.permiteInativo) {
    if (accessDecision(session.tenantStatus, session.subStatus) === "blocked") {
      redirect("/conta/suspensa");
    }
  }

  if (opts?.modulo && !isModuleEnabled(session.modules, opts.modulo)) {
    redirect(`/plano?bloqueado=${opts.modulo}`);
  }

  return { session, tenantId };
}
