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

/** Por onde o dinheiro da conta saiu. Sem FIADO: conta a pagar não é fiado. */
export const EXPENSE_PAYMENT_METHOD_LABELS: Record<string, string> = {
  PIX: "PIX",
  DINHEIRO: "Dinheiro",
  TRANSFERENCIA: "Transferência",
  BOLETO: "Boleto",
  CARTAO: "Cartão",
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
  ATIVO: "Ativo",
  TRIAL: "Teste grátis",
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
  SAIDA_HIGIENIZACAO: "Enviada p/ higienização",
  RETORNO_HIGIENIZACAO: "Voltou da higienização",
  ESTORNO_SAIDA: "Estorno de venda cancelada",
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
  ACCESS_REVOKED: "revogou o acesso de",
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
  TenantCeasaLink: "vínculo de cotação",
  TenantCeasaAlerta: "alerta de cotação",
  Tenant: "empresa",
  User: "usuário",
  TenantSubscription: "assinatura",
  SubscriptionPayment: "pagamento de mensalidade",
};

/**
 * Desfecho de uma importação de boletim, na tela do super-admin.
 *
 * "Sem boletim" e "Falhou" são coisas diferentes e precisam LER como coisas
 * diferentes: domingo e feriado caem no primeiro, e chamar isso de falha
 * ensinaria o operador a ignorar o aviso — que é justamente o que não pode
 * acontecer com o alarme de uma raspagem.
 */
/**
 * De onde vem o número que a tela mostra.
 *
 * As duas séries não são comparáveis entre si, e o rótulo é o que evita a
 * confusão: uma é o boletim da própria praça, com o produto detalhado e a
 * classificação que o comerciante conhece; a outra é a série agregada do país,
 * com produto genérico, que serve para acompanhar tendência e comparar praças.
 */
export const CEASA_SERIE_LABELS: Record<string, string> = {
  CENTRAL: "Boletim da praça",
  NACIONAL: "Série nacional",
};

export const CEASA_IMPORT_STATUS_LABELS: Record<string, string> = {
  OK: "Importado",
  VAZIO: "Sem boletim no dia",
  FALHA: "Falhou",
};

/**
 * Estado do boletim que o CLIENTE enviou para publicação.
 *
 * "Aguardando revisão" e não "pendente": o cliente precisa saber que a bola está
 * com a plataforma, não com ele. "Pendente" lê como se faltasse algo dele, e
 * quem lê isso reenvia o mesmo boletim achando que o primeiro não chegou.
 */
export const BOLETIM_ENVIADO_STATUS_LABELS: Record<string, string> = {
  PENDENTE: "aguardando revisão",
  PUBLICADO: "publicado",
  RECUSADO: "recusado",
};

export function toOptions(map: Record<string, string>) {
  return Object.entries(map).map(([value, label]) => ({ value, label }));
}
