/** Constantes puras (sem dependências) — seguras para importar em qualquer contexto. */

/** Categorias de despesa iniciais (README §8.10). */
export const DEFAULT_EXPENSE_CATEGORIES = [
  "Aluguel do box",
  "Energia elétrica",
  "Internet",
  "Contabilidade",
  "Pró-labore",
  "Impostos",
  "Seguro",
  "Condomínio",
  "Água",
  "Telefone",
  "Salários",
  "INSS",
  "Sistema de gestão",
  "Outros",
];

/** Tipos de embalagem sugeridos (Fase 2 — venda de embalagens). */
export const DEFAULT_PACKAGING_TYPES = [
  "Caixa plástica",
  "Caixa de papelão",
  "Caixa de madeira",
  "Sacaria",
];

/**
 * Unidades da federação, para o cadastro e a escolha da central do CEASA.
 *
 * Lista fechada e ordenada por sigla: é o que o `<select>` oferece e o que o
 * schema valida. Guardar a sigla (e não o nome por extenso) mantém a coluna
 * `CHAR(2)` e o filtro de centrais falando a mesma língua.
 */
export const UFS = [
  { sigla: "AC", nome: "Acre" },
  { sigla: "AL", nome: "Alagoas" },
  { sigla: "AM", nome: "Amazonas" },
  { sigla: "AP", nome: "Amapá" },
  { sigla: "BA", nome: "Bahia" },
  { sigla: "CE", nome: "Ceará" },
  { sigla: "DF", nome: "Distrito Federal" },
  { sigla: "ES", nome: "Espírito Santo" },
  { sigla: "GO", nome: "Goiás" },
  { sigla: "MA", nome: "Maranhão" },
  { sigla: "MG", nome: "Minas Gerais" },
  { sigla: "MS", nome: "Mato Grosso do Sul" },
  { sigla: "MT", nome: "Mato Grosso" },
  { sigla: "PA", nome: "Pará" },
  { sigla: "PB", nome: "Paraíba" },
  { sigla: "PE", nome: "Pernambuco" },
  { sigla: "PI", nome: "Piauí" },
  { sigla: "PR", nome: "Paraná" },
  { sigla: "RJ", nome: "Rio de Janeiro" },
  { sigla: "RN", nome: "Rio Grande do Norte" },
  { sigla: "RO", nome: "Rondônia" },
  { sigla: "RR", nome: "Roraima" },
  { sigla: "RS", nome: "Rio Grande do Sul" },
  { sigla: "SC", nome: "Santa Catarina" },
  { sigla: "SE", nome: "Sergipe" },
  { sigla: "SP", nome: "São Paulo" },
  { sigla: "TO", nome: "Tocantins" },
] as const;

export const SIGLAS_UF: readonly string[] = UFS.map((u) => u.sigla);

export function ehUfValida(v: string): boolean {
  return SIGLAS_UF.includes(v.toUpperCase());
}
