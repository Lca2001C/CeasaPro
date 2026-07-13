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

export const CRATE_MOVEMENT_LABELS: Record<string, string> = {
  ENTRADA: "Entrada",
  SAIDA: "Saída p/ cliente",
  RETORNO: "Retorno de cliente",
  QUEBRA: "Quebra/Perda",
};

export const CRATE_CLEANING_STATUS_LABELS: Record<string, string> = {
  ENVIADO: "Enviado",
  DEVOLVIDO: "Devolvido",
  PAGO: "Pago",
};

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  CREATE: "cadastrou",
  UPDATE: "alterou",
  DELETE: "excluiu",
  PAYMENT: "registrou pagamento em",
  LOGIN: "entrou no sistema",
  STATUS_CHANGE: "alterou a situação de",
};

export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  Product: "produto",
  Supplier: "fornecedor",
  Purchase: "compra",
  Sale: "venda",
  CreditAccount: "conta de fiado",
  CreditPayment: "pagamento de fiado",
  StockMovement: "movimentação de estoque",
  Expense: "despesa",
  ExpenseCategory: "categoria de despesa",
  PlasticCrateMovement: "movimentação de caixas",
  CrateCleaning: "higienização",
  PackagingType: "tipo de embalagem",
  PackagingSale: "venda de embalagem",
  Tenant: "empresa",
  User: "usuário",
  TenantSubscription: "assinatura",
  SubscriptionPayment: "pagamento de mensalidade",
};

export function toOptions(map: Record<string, string>) {
  return Object.entries(map).map(([value, label]) => ({ value, label }));
}
