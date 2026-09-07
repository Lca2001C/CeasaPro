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
  "cotacoes",
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
  cotacoes: {
    key: "cotacoes",
    label: "Cotações do CEASA",
    // A palavra "diário" está aqui de propósito, e é o ajuste de expectativa
    // mais barato que existe: esta descrição aparece em /plano e na Ajuda, antes
    // de o cliente abrir a tela e concluir sozinho que os preços são do momento.
    description:
      "Preços do boletim diário da sua central do CEASA, com destaque para os produtos que você tem em estoque.",
    pathPrefixes: ["/cotacoes"],
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
 *
 * Fail-CLOSED: sem a lista, nada é liberado.
 *
 * Era o contrário — `undefined` liberava tudo, para o rollout do claim ser
 * suave. O problema é que `undefined` tinha DOIS donos: "token legado, de antes
 * do claim" e "super-admin, que não deve ser barrado". Essa colisão obrigava o
 * guard a ser permissivo para todo mundo, e qualquer sessão sem o claim —
 * inclusive uma forjada — passava por todos os gates de módulo.
 *
 * `build-session` agora emite a lista SEMPRE, e o super-admin recebe a lista
 * completa explícita, então `undefined` deixou de significar algo legítimo.
 *
 * Sobre a janela de transição: esta virada vai no MESMO deploy que troca a
 * chave de assinatura do access token (`keys.ts`). Como todo token anterior
 * deixa de valer nesse instante, não existe token em circulação sem o claim —
 * a janela de 15 minutos que exigiria dois deploys separados não chega a
 * existir.
 */
export function isModuleEnabled(
  modules: string[] | undefined,
  key: OptionalModuleKey,
): boolean {
  if (!modules) return false;
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
