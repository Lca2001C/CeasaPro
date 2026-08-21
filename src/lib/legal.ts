/**
 * Documentos legais (Termos de Uso e Política de Privacidade).
 *
 * A versão é gravada junto com o aceite em `Tenant.termsVersion`. Ao publicar
 * uma revisão dos documentos, incremente a data aqui: assinantes com versão
 * anterior voltam a ver o checkbox de aceite no próximo checkout, o que dá a
 * prova exigida pelo art. 8º da LGPD (consentimento por versão do documento).
 */
export const TERMS_VERSION = "2026-08-20";

/** Data da última revisão, exibida no cabeçalho das páginas legais. */
export const TERMS_UPDATED_AT = "20 de agosto de 2026";

/** Identificação do controlador dos dados, exigida pela LGPD. */
export const LEGAL_ENTITY = {
  name: "CeasaPro",
  supportEmail: "suporte@ceasapro.com.br",
  privacyEmail: "privacidade@ceasapro.com.br",
} as const;
