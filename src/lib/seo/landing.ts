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
 * JSON-LD SoftwareApplication — o Google lê o texto; o CSP bloqueia execução,
 * então o script na página leva o nonce da requisição.
 */
export function softwareApplicationLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "CeasaPro",
    alternateName: "CEASA PRO",
    url: CANONICAL_URL,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: LANDING_DESCRIPTION,
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
