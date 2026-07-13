/**
 * Catálogo de módulos gateáveis por plano — FONTE ÚNICA DA VERDADE.
 * Usado por: token (build-session), middleware, navegação, guards de servidor,
 * relatórios e painel do super-admin. Não repetir chaves de módulo em outro lugar.
 */
import { ForbiddenError } from "@/lib/http/app-error";

export const OPTIONAL_MODULE_KEYS = [
  "caixas",
  "higienizacao",
  "embalagens",
  "relatorios_avancados",
] as const;

export type OptionalModuleKey = (typeof OPTIONAL_MODULE_KEYS)[number];

export interface OptionalModule {
  key: OptionalModuleKey;
  label: string;
  description: string;
  /** Prefixos de rota que este módulo protege (vazio = gate por outro meio, ex.: tipo de relatório). */
  pathPrefixes: string[];
}

export const OPTIONAL_MODULES: Record<OptionalModuleKey, OptionalModule> = {
  caixas: {
    key: "caixas",
    label: "Caixas plásticas",
    description: "Controle de entrada, saída, retorno e perdas de caixas plásticas.",
    pathPrefixes: ["/caixas-plasticas"],
  },
  higienizacao: {
    key: "higienizacao",
    label: "Higienização",
    description: "Envio de caixas para higienização e o financeiro do serviço.",
    pathPrefixes: ["/higienizacao"],
  },
  embalagens: {
    key: "embalagens",
    label: "Venda de embalagens",
    description: "Venda de caixas, sacaria e outras embalagens à parte.",
    pathPrefixes: ["/embalagens"],
  },
  relatorios_avancados: {
    key: "relatorios_avancados",
    label: "Relatórios avançados",
    description:
      "Lucro por produto, mais vendidos, inadimplentes, fornecedores, fluxo de caixa e mais.",
    pathPrefixes: [], // gate por tipo de relatório, não por rota
  },
};

export const ALL_OPTIONAL_KEYS: OptionalModuleKey[] = [...OPTIONAL_MODULE_KEYS];

export function isOptionalModuleKey(v: string): v is OptionalModuleKey {
  return (OPTIONAL_MODULE_KEYS as readonly string[]).includes(v);
}

/**
 * Lê os módulos habilitados a partir de `Plan.features`.
 * Retrocompatível: plano sem `features.modules` ⇒ TODOS os opcionais liberados.
 */
export function planModules(features: unknown): OptionalModuleKey[] {
  if (features && typeof features === "object" && "modules" in features) {
    const raw = (features as { modules?: unknown }).modules;
    if (Array.isArray(raw)) {
      return raw.filter((m): m is OptionalModuleKey => typeof m === "string" && isOptionalModuleKey(m));
    }
  }
  return [...ALL_OPTIONAL_KEYS];
}

/** Mapeia um caminho a um módulo opcional (ou null se for núcleo). */
export function moduleForPath(pathname: string): OptionalModuleKey | null {
  for (const mod of Object.values(OPTIONAL_MODULES)) {
    if (mod.pathPrefixes.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
      return mod.key;
    }
  }
  return null;
}

/**
 * Um módulo está habilitado?
 * `modules === undefined` (token legado, sem o claim) ⇒ tudo liberado (rollout suave).
 */
export function isModuleEnabled(
  modules: string[] | undefined,
  key: OptionalModuleKey,
): boolean {
  if (modules === undefined) return true;
  return modules.includes(key);
}

/**
 * Guard de servidor (defense in depth): lança ForbiddenError se o módulo não
 * estiver habilitado na sessão. Recebe a lista de módulos da SESSÃO verificada
 * (nunca de input do cliente). Usado pelos wrappers e pelo gating de relatórios.
 */
export function requireModule(
  modules: string[] | undefined,
  key: OptionalModuleKey,
): void {
  if (!isModuleEnabled(modules, key)) {
    throw new ForbiddenError(
      `O recurso "${OPTIONAL_MODULES[key].label}" não está incluído no seu plano.`,
    );
  }
}
