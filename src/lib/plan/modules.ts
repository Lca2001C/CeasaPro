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
  "ceasanews",
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
    /*
      Esta descrição aparece em `/plano`, ANTES da compra, e na Ajuda. É o ajuste
      de expectativa mais barato que existe — e por isso ela diz as duas coisas
      que o cliente descobriria sozinho, tarde:

      1. É BOLETIM, não preço do momento. O preço de agora é negociado no balcão
         e nenhuma central divulga.
      2. A busca automática ainda não cobre o país. Das 65 centrais do catálogo,
         9 são buscadas sozinhas; nas outras o boletim depende de envio manual.
         Vender "preços do CEASA" para quem compra em Recife, sem essa ressalva,
         seria vender o que não se entrega.
    */
    description:
      "Preços do boletim da sua central do CEASA, com destaque para os produtos que você tem em estoque. A busca automática cobre hoje as centrais de MG, ES e o Entreposto de São Paulo (CEAGESP); nas demais praças, o boletim depende de envio manual.",
    pathPrefixes: ["/cotacoes"],
  },
  ceasanews: {
    key: "ceasanews",
    label: "CeasaNews",
    /*
      Como a de Cotações, diz o que o módulo é e o que NÃO é: um apanhado de
      notícias de veículos de terceiros, com link para a matéria — não
      jornalismo próprio nem preço do momento.
    */
    description:
      "Notícias do mercado de hortifruti num lugar só: CEASAs, preços, clima, frete e safra, filtradas de veículos do agro e do Google Notícias, com destaque para o que fala dos seus produtos. Cada notícia leva à matéria original.",
    pathPrefixes: ["/ceasanews"],
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
 *
 * Fail-CLOSED: plano sem `features.modules` não libera módulo opcional nenhum.
 *
 * Era o contrário — ausência de lista significava "todos liberados", para os
 * planos anteriores ao catálogo de módulos continuarem funcionando. O problema é
 * que essa retrocompatibilidade nunca expirou e virou o caminho mais fácil de
 * entregar o produto inteiro de graça: qualquer plano criado sem o campo (uma
 * migração de dados, um `prisma.plan.create` num script, o plano interno do
 * ambiente do super-admin, que nasce com `features: {}`) valia como plano
 * completo — e o erro era SILENCIOSO, porque a tela mostra recurso liberado e
 * nada indica que aquilo não foi vendido.
 *
 * É a mesma decisão que `isModuleEnabled` já tinha tomado para o claim do token:
 * ausência de informação não é permissão. O preço é que um plano mal cadastrado
 * entrega menos do que deveria — reclamação que chega ao suporte no primeiro dia
 * e se conserta em `/admin/planos`, ao contrário da receita que se perde sem
 * ninguém notar. `AdminService` agora exige a lista ao criar e ao salvar plano,
 * então o caso "sem campo" só sobrevive em dado antigo.
 */
export function planModules(features: unknown): OptionalModuleKey[] {
  if (features && typeof features === "object" && "modules" in features) {
    const raw = (features as { modules?: unknown }).modules;
    if (Array.isArray(raw)) {
      return raw.filter((m): m is OptionalModuleKey => typeof m === "string" && isOptionalModuleKey(m));
    }
  }
  return [];
}

/**
 * Telas que servem a MAIS DE UM módulo: entra quem tiver qualquer um deles.
 *
 * Só o caminho EXATO. `/caixas-plasticas` reúne a aba de caixas e a de
 * embalagens, mas as subtelas (`/caixas-plasticas/novo`) continuam do módulo
 * dono, pelo prefixo dele — uma tela nova embaixo daqui nasce exigindo
 * `caixas`, e não "qualquer um dos dois". As chaves NÃO se juntam: quem
 * contratou só embalagens continua sem caixas.
 */
export const TELAS_COMPARTILHADAS: Readonly<Record<string, readonly OptionalModuleKey[]>> = {
  "/caixas-plasticas": ["caixas", "embalagens"],
};

/**
 * Os módulos que abrem um caminho — basta UM deles — ou null se for núcleo.
 * É a pergunta que o proxy e o menu fazem; `moduleForPath` responde só pelo
 * prefixo de cada módulo.
 */
export function modulosDaRota(pathname: string): readonly OptionalModuleKey[] | null {
  if (Object.hasOwn(TELAS_COMPARTILHADAS, pathname)) return TELAS_COMPARTILHADAS[pathname]!;
  const mod = moduleForPath(pathname);
  return mod ? [mod] : null;
}

/** O plano da sessão abre este caminho? (núcleo: sempre) */
export function rotaLiberada(modules: string[] | undefined, pathname: string): boolean {
  const mods = modulosDaRota(pathname);
  return !mods || mods.some((m) => isModuleEnabled(modules, m));
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
