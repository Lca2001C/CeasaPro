/** Rótulos em português para os enums do sistema + listas para <select>. */

export const SALE_UNIT_LABELS: Record<string, string> = {
  CAIXA: "Caixa",
  KG: "Quilograma (kg)",
  SACO: "Saco",
  BANDEJA: "Bandeja",
  UNIDADE: "Unidade",
};

export const RECIPIENT_TYPE_LABELS: Record<string, string> = {
  PLASTICA: "Caixa plástica",
  PAPELAO: "Caixa de papelão",
  MADEIRA: "Caixa de madeira",
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  PIX: "PIX",
  DINHEIRO: "Dinheiro",
  CARTAO: "Cartão",
  FIADO: "Fiado",
};

export const EXPENSE_TYPE_LABELS: Record<string, string> = {
  FIXA: "Fixa",
  VARIAVEL: "Variável",
};

export const EXPENSE_STATUS_LABELS: Record<string, string> = {
  PENDENTE: "Pendente",
  PAGO: "Pago",
};

export const CREDIT_STATUS_LABELS: Record<string, string> = {
  EM_ABERTO: "Em aberto",
  PAGO: "Pago",
};

export const STOCK_MOVEMENT_LABELS: Record<string, string> = {
  ENTRADA: "Entrada",
  SAIDA: "Saída",
  QUEBRA: "Quebra/Perda",
  DOACAO: "Doação",
  AJUSTE: "Ajuste",
};

export const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  TRIAL: "Período grátis",
  ATIVO: "Ativo",
  VENCIDO: "Vencido",
  SUSPENSO: "Suspenso",
  BLOQUEADO: "Bloqueado",
  CANCELADO: "Cancelado",
};

export const TENANT_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Ativa",
  SUSPENDED: "Suspensa",
  BLOCKED: "Bloqueada",
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDENTE: "Pendente",
  APROVADO: "Aprovado",
  RECUSADO: "Recusado",
  ESTORNADO: "Estornado",
  CANCELADO: "Cancelado",
};

export function toOptions(map: Record<string, string>) {
  return Object.entries(map).map(([value, label]) => ({ value, label }));
}
