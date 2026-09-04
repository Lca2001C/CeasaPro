import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as labels from "@/lib/labels";

/**
 * Todo valor de enum do Prisma tem rótulo em português?
 *
 * As telas mostram `LABELS[valor]`. Quando o valor não está no mapa, o React
 * renderiza **nada** — o campo fica em branco. Sem erro, sem log, sem teste
 * falhando: só um espaço vazio onde devia estar "Enviada p/ higienização".
 *
 * Não é hipótese: os últimos ciclos acrescentaram `ESTORNO_SAIDA` a
 * `PlasticCrateMovementType`, `CONTAS_PAGAS` a `ReportType` e o enum novo
 * `ExpensePaymentMethod`. Cada um exigiu lembrar do rótulo à mão, e nada
 * cobrava. Este teste passa a cobrar.
 *
 * Compara o schema (a verdade) com os mapas (código), como
 * `models-tenant-cobertura` e `relatorios-grupos` já fazem para as listas deles.
 */

const schema = readFileSync("prisma/schema.prisma", "utf8");

/** Valores de cada enum declarado no schema. */
const enums: Record<string, string[]> = {};
for (const m of schema.matchAll(/^enum\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
  enums[m[1]!] = [...m[2]!.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*(?:\/\/.*)?$/gm)].map((x) => x[1]!);
}

/**
 * Mapa de rótulo → enum que ele traduz.
 *
 * Escrito à mão de propósito: é a declaração de qual mapa serve a qual enum, e
 * é ela que faz o teste falhar quando um enum novo aparece sem par (ver o
 * último caso deste arquivo).
 */
const PARES: Record<string, string> = {
  SALE_UNIT_LABELS: "SaleUnit",
  RECIPIENT_TYPE_LABELS: "RecipientType",
  PAYMENT_METHOD_LABELS: "PaymentMethod",
  CREDIT_STATUS_LABELS: "CreditStatus",
  EXPENSE_TYPE_LABELS: "ExpenseType",
  EXPENSE_STATUS_LABELS: "ExpenseStatus",
  EXPENSE_PAYMENT_METHOD_LABELS: "ExpensePaymentMethod",
  STOCK_MOVEMENT_LABELS: "StockMovementType",
  CRATE_MOVEMENT_LABELS: "PlasticCrateMovementType",
  CRATE_CLEANING_STATUS_LABELS: "CrateCleaningStatus",
  SUBSCRIPTION_STATUS_LABELS: "SubscriptionStatus",
  PAYMENT_STATUS_LABELS: "PaymentStatus",
  TENANT_STATUS_LABELS: "TenantStatus",
};

/**
 * Enums que NÃO precisam de mapa, com o motivo.
 *
 * Acrescentar um nome aqui é uma decisão de produto ("este valor nunca aparece
 * para o usuário"), não um jeito de calar o teste.
 */
const SEM_ROTULO: Record<string, string> = {
  UserRole: "papel interno; nunca é exibido ao usuário da empresa",
  StatusSource: "AUTO/MANUAL é metadado do super-admin, não texto de tela",
  ReportFormat: "PDF/EXCEL aparece como botão próprio, não como rótulo traduzido",
  ReportStatus: "estado interno do registro de exportação",
  ReportType: "traduzido por REPORT_LABELS, coberto em relatorios-grupos.test.ts",
  ChargeMethod: "forma da cobrança da plataforma; a tela de assinatura tem texto próprio",
  PackagingMovementType:
    "movimento de estoque de embalagem é escrituração interna; a tela mostra o nome da embalagem, nunca o tipo do movimento",
  AdminNotificationKind: "discriminador da caixa de avisos do super-admin; a tela monta o texto a partir dos dados, não do enum",
};

const mapa = (nome: string): Record<string, string> =>
  (labels as unknown as Record<string, Record<string, string>>)[nome]!;

describe("cobertura de rótulos dos enums", () => {
  it("o schema foi lido de verdade", () => {
    // Se o regex parar de casar, o teste tem de falhar em vez de passar vazio.
    expect(Object.keys(enums).length).toBeGreaterThan(10);
    expect(enums.PaymentMethod).toContain("PIX");
  });

  for (const [nomeMapa, nomeEnum] of Object.entries(PARES)) {
    it(`${nomeMapa} traduz todo ${nomeEnum}`, () => {
      const valores = enums[nomeEnum];
      expect(valores, `enum ${nomeEnum} não existe no schema`).toBeDefined();

      const m = mapa(nomeMapa);
      expect(m, `${nomeMapa} não é exportado de labels.ts`).toBeDefined();

      const semRotulo = valores!.filter((v) => !m[v]);
      expect(
        semRotulo,
        `sem rótulo em ${nomeMapa} — a tela renderiza vazio nesses valores`,
      ).toEqual([]);
    });
  }

  it("nenhum rótulo aponta para valor que saiu do enum", () => {
    // Rótulo órfão é sinal de enum renomeado pela metade.
    const orfaos: string[] = [];
    for (const [nomeMapa, nomeEnum] of Object.entries(PARES)) {
      const valores = enums[nomeEnum] ?? [];
      for (const chave of Object.keys(mapa(nomeMapa))) {
        if (!valores.includes(chave)) orfaos.push(`${nomeMapa}.${chave}`);
      }
    }
    expect(orfaos, "rótulo para valor que não existe mais no enum").toEqual([]);
  });

  it("todo enum do schema está pareado ou dispensado com motivo", () => {
    // É este caso que pega o enum NOVO: quem acrescentar um sem rótulo e sem
    // justificativa vê o CI reprovar, em vez de descobrir pelo campo em branco.
    const pareados = new Set(Object.values(PARES));
    const esquecidos = Object.keys(enums).filter(
      (e) => !pareados.has(e) && !(e in SEM_ROTULO),
    );
    expect(
      esquecidos,
      "enum sem mapa de rótulo e sem justificativa em SEM_ROTULO",
    ).toEqual([]);
  });

  it("as dispensas ainda correspondem a enums existentes", () => {
    const fantasmas = Object.keys(SEM_ROTULO).filter((e) => !(e in enums));
    expect(fantasmas, "justificativa para enum que não existe mais").toEqual([]);
  });

  it("nenhum rótulo é string vazia", () => {
    // Chave presente com texto vazio passa pelas checagens acima e ainda
    // renderiza em branco na tela.
    const vazios: string[] = [];
    for (const nomeMapa of Object.keys(PARES)) {
      for (const [chave, texto] of Object.entries(mapa(nomeMapa))) {
        if (!String(texto).trim()) vazios.push(`${nomeMapa}.${chave}`);
      }
    }
    expect(vazios).toEqual([]);
  });
});
