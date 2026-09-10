import type { Metadata } from "next";
import { TRIAL_DAYS } from "@/lib/billing/status";

/**
 * Origem canônica de indexação.
 *
 * Apex (`ceasapro.com.br`) redireciona para `www`. Sem canonical absoluto, o
 * Google trata as duas como páginas distintas e dilui a indexação.
 */
export const CANONICAL_ORIGIN = "https://www.ceasapro.com.br";
export const CANONICAL_URL = `${CANONICAL_ORIGIN}/`;

/** Title tag da landing — cabe no SERP (~60 caracteres). */
export const LANDING_TITLE =
  "CeasaPro | Sistema de Gestão para Atacadistas e Hortifrúti";

/**
 * Meta description da landing.
 *
 * Teto de 155 caracteres do snippet do Google. Fala a dor do box (estoque,
 * caixaria, vendas, lista de carga) sem prometer módulo que o produto não tem.
 */
export const LANDING_DESCRIPTION = `Controle estoque, caixaria, vendas e romaneios do box na CEASA. Gestão para atacadistas e hortifrúti. Teste ${TRIAL_DAYS} dias grátis.`;

export const LANDING_OG_ALT =
  "CeasaPro — sistema de gestão para atacadistas e hortifrúti no CEASA, com estoque, caixaria e vendas";

/** Recursos reais do produto, em linguagem de busca do setor. */
export const LANDING_FEATURE_LIST = [
  "Frente de caixa e vendas no box",
  "Controle de estoque de hortifrúti",
  "Gestão de caixaria e embalagens",
  "Controle de fiado no box",
  "Controle financeiro do box",
  "Relatórios de venda e carga em Excel e PDF",
] as const;

export function landingMetadata(): Metadata {
  return {
    title: LANDING_TITLE,
    description: LANDING_DESCRIPTION,
    alternates: { canonical: CANONICAL_URL },
    openGraph: {
      title: LANDING_TITLE,
      description: LANDING_DESCRIPTION,
      url: CANONICAL_URL,
      siteName: "CeasaPro",
      locale: "pt_BR",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: LANDING_TITLE,
      description: LANDING_DESCRIPTION,
    },
  };
}

/**
 * Logotipo em URL ABSOLUTA.
 *
 * O `logo` do JSON-LD é uma das entradas que o Google usa para escolher o
 * ícone do resultado de busca, junto do `<link rel="icon">`. Caminho relativo
 * não serve: o consumidor do dado é um rastreador que pode ter lido o JSON
 * fora do contexto da página.
 *
 * Aponta para o PNG de 512 e não para o `.ico` porque o `logo` do schema.org é
 * lido como imagem comum (o mínimo que o Google aceita é 112 px), e porque
 * `/icons/` está fora do matcher do proxy — um logotipo que responde redirect
 * para `/login` é um logotipo que o Google descarta.
 */
export const LOGO_URL = `${CANONICAL_ORIGIN}/icons/icon-512.png`;

/**
 * JSON-LD Organization — quem publica o software.
 *
 * Existe separado do `SoftwareApplication` porque são coisas diferentes para o
 * Google: o primeiro descreve a EMPRESA (e é o nó que carrega `logo`), o
 * segundo descreve o PRODUTO. Sem o nó de organização não há `logo` nenhum na
 * página, e a única pista de marca que sobra é o favicon.
 *
 * O `@id` amarra os dois nós do `@graph`: sem ele o Google vê dois objetos
 * soltos e não sabe que a organização é a publicadora do aplicativo.
 */
export function organizationLd() {
  return {
    "@type": "Organization",
    "@id": `${CANONICAL_ORIGIN}/#organizacao`,
    name: "CeasaPro",
    alternateName: "CEASA PRO",
    url: CANONICAL_URL,
    logo: LOGO_URL,
    image: LOGO_URL,
    description: LANDING_DESCRIPTION,
  };
}

/**
 * Os dois nós num único `@graph`.
 *
 * Um `<script>` só, em vez de dois: o CSP exige nonce por script, e cada script
 * a mais é mais uma chance de alguém acrescentar um sem o nonce e descobrir só
 * em produção, quando o navegador o bloqueia em silêncio.
 */
export function landingJsonLd() {
  return {
    // Um `@context` só, aqui na raiz. Os nós entram sem o seu — repetir o
    // contexto dentro de cada um é válido em JSON-LD, mas é ruído que o
    // validador do Google aponta.
    "@context": "https://schema.org",
    "@graph": [organizationLd(), aplicacaoNo()],
  };
}

/**
 * O nó do produto, sem `@context` — é esta forma que entra no `@graph`.
 *
 * Separado de `softwareApplicationLd()` porque as duas formas têm usos
 * diferentes: o nó vai para dentro do grafo, e o documento completo (com
 * contexto) vale sozinho, que é como `landing-seo.test.ts` o exercita.
 */
function aplicacaoNo() {
  return {
    "@type": "SoftwareApplication",
    name: "CeasaPro",
    alternateName: "CEASA PRO",
    url: CANONICAL_URL,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: LANDING_DESCRIPTION,
    // Amarra o produto a quem o publica. É por esta referência que o Google
    // liga o `logo` da organização a esta aplicação; sem ela os dois nós do
    // grafo ficam soltos.
    publisher: { "@id": `${CANONICAL_ORIGIN}/#organizacao` },
    featureList: [...LANDING_FEATURE_LIST],
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "BRL",
      description: `Teste de ${TRIAL_DAYS} dias grátis, sem cartão`,
    },
    inLanguage: "pt-BR",
  };
}

/**
 * JSON-LD SoftwareApplication — o Google lê o texto; o CSP bloqueia execução,
 * então o script na página leva o nonce da requisição.
 */
export function softwareApplicationLd() {
  return { "@context": "https://schema.org", ...aplicacaoNo() };
}
