import { z } from "zod";
import {
  calcularTotaisVenda,
  centsParaNumero,
  paraCentavos,
  parteEmDinheiroCents,
  somaParcelasCents,
  TOLERANCIA_CENTAVOS_BIG,
  totalDaVendaCents,
} from "@/lib/venda/total";

export const paymentMethodEnum = z.enum(["PIX", "DINHEIRO", "CARTAO", "FIADO"]);

export const recipientTypeEnum = z.enum(["PLASTICA", "PAPELAO", "MADEIRA"]);

export const vendaItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().positive("Quantidade inválida"),
  unitPrice: z.number().nonnegative("Preço inválido"),
  recipientType: recipientTypeEnum.nullable().optional(),
  crateQty: z.number().int().nonnegative("Quantidade de caixas inválida").optional(),
  /** Desconto desta linha, em reais. Nunca maior que o valor da linha. */
  discountAmount: z.number().nonnegative("Desconto inválido").optional(),
});

/** Uma forma de pagamento e o quanto foi pago nela (pagamento misto). */
export const vendaPagamentoSchema = z.object({
  method: paymentMethodEnum,
  amount: z.number().positive("Informe o valor desta forma de pagamento"),
});
export type VendaPagamentoInput = z.infer<typeof vendaPagamentoSchema>;

/** Tolerância de um centavo — definida no contrato compartilhado. */
export { TOLERANCIA_CENTAVOS_BIG };
/** A mesma tolerância em reais, para a interface. */
export const TOLERANCIA_CENTAVOS = 0.01;

/**
 * Teto do troco, em centavos.
 *
 * `amountReceived` não tinha limite nenhum: `999999999` numa venda de R$ 50
 * gravava um troco de R$ 999.999.949 e nenhum relatório de caixa sobrevivia a
 * isso. A regra é generosa de propósito — pagar R$ 3 com uma nota de R$ 200 é
 * corriqueiro — mas fecha o dedo escorregado no teclado: o troco não passa do
 * maior entre R$ 500 e a própria parte paga em espécie.
 */
const TROCO_MAXIMO_CENTS = 50_000n;

const vendaBase = z.object({
  customerName: z.string().trim().max(120).nullable().optional(),
  customerPhone: z.string().trim().max(20).nullable().optional(),
  paymentMethod: paymentMethodEnum,
  /**
   * Pagamento misto: as parcelas têm de somar o total cobrado.
   * Omitido (ou com uma parcela só) = venda de forma única, como sempre foi.
   */
  payments: z.array(vendaPagamentoSchema).max(4, "No máximo 4 formas de pagamento").optional(),
  saleDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  /** Caixas plásticas que saíram na venda. Se omitido, soma os itens PLASTICA. */
  plasticCrateQty: z.number().int().nonnegative("Quantidade de caixas inválida").optional(),
  /** Desconto sobre o total da venda (os descontos por item ficam na linha). */
  discountAmount: z.number().nonnegative("Desconto inválido").optional(),
  discountReason: z.string().trim().max(200).nullable().optional(),
  /**
   * Dinheiro que o cliente entregou para a parte paga EM ESPÉCIE.
   *
   * Não é "o quanto ele deu pela venda": numa venda mista de R$ 100 com R$ 60
   * em PIX e R$ 40 em dinheiro, quem entrega uma nota de R$ 50 tem R$ 10 de
   * troco — e não zero, que era o que o sistema calculava comparando com o
   * total.
   */
  amountReceived: z.number().nonnegative().nullable().optional(),
  /**
   * Confirmação explícita de que um item vai com preço zero.
   *
   * Sem isto, esquecer o preço de um produto novo passava batido e a venda
   * entrava zerada — distorcendo faturamento e lucro sem ninguém perceber.
   */
  permitirPrecoZero: z.boolean().optional(),
  /**
   * Chave de idempotência do carrinho, gerada pelo PDV.
   *
   * Opcional de propósito: um PWA com bundle antigo em cache continua
   * funcionando depois do deploy, e o fiado manual não tem carrinho.
   */
  idempotencyKey: z.uuid().optional(),
  items: z.array(vendaItemSchema).min(1, "Adicione ao menos um item"),
});

export type VendaInput = z.infer<typeof vendaBase>;

/**
 * Caixas plásticas da venda: o valor informado ou a soma dos itens em caixa
 * plástica.
 *
 * Mora aqui, e não no serviço, porque a validação PRECISA da mesma resposta:
 * enquanto o refine olhava só o campo cru e o serviço resolvia a quantidade,
 * os dois discordavam sobre quantas caixas saíram.
 *
 * `0` conta como "não informado". Antes o teste era `!== undefined`, e o PDV
 * mandava `plasticCrateQty: 0` SEMPRE que o checkbox estava desmarcado — então
 * o zero vencia a soma por item, e quem preenchia "Vasilhame: Plástica, 8" na
 * linha do produto via as 8 caixas gravadas em `sale_items.crateQty` e exibidas
 * na tela de detalhe, sem nenhum `PlasticCrateMovement`. Saíam do box parecendo
 * contabilizadas.
 */
export function resolvePlasticCrateQty(input: {
  plasticCrateQty?: number | null;
  items: readonly { recipientType?: string | null; crateQty?: number | null }[];
}): number {
  if (input.plasticCrateQty != null && input.plasticCrateQty > 0) {
    return input.plasticCrateQty;
  }
  return input.items.reduce(
    (total, i) => total + (i.recipientType === "PLASTICA" ? (i.crateQty ?? 0) : 0),
    0,
  );
}

/**
 * Bruto da linha, antes do desconto dela.
 *
 * Delega ao contrato compartilhado — o servidor multiplica em precisão cheia e
 * arredonda o produto, e não as entradas.
 */
export function brutoDoItem(i: { quantity: number; unitPrice: number }): number {
  return centsParaNumero(calcularTotaisVenda({ items: [i] }).brutosCents[0]!);
}

/** Total cobrado: soma das linhas (já líquidas) menos o desconto da venda. */
export function totalDaVenda(v: {
  items: { quantity: number; unitPrice: number; discountAmount?: number }[];
  discountAmount?: number;
}): number {
  return centsParaNumero(totalDaVendaCents(v));
}

/** Soma das linhas já líquidas do desconto de cada uma, em centavos. */
function somaDasLinhasCents(v: {
  items: { quantity: number; unitPrice: number; discountAmount?: number }[];
}): bigint {
  return calcularTotaisVenda(v).lineTotalsCents.reduce((a, l) => a + l, 0n);
}

export const vendaSchema = vendaBase
  .refine((v) => v.paymentMethod !== "FIADO" || (v.customerName && v.customerName.length > 0), {
    message: "Informe o cliente para venda fiada",
    path: ["customerName"],
  })
  // Caixa plástica exige cliente — e a conta é a RESOLVIDA, não o campo cru.
  // Sem isto, um POST com `recipientType: "PLASTICA"` e `crateQty` nos itens,
  // mas sem `plasticCrateQty` e sem `customerName`, gravava um movimento de
  // SAÍDA com cliente nulo: as caixas saíam do box e nenhum RETORNO conseguia
  // devolvê-las, porque devolução exige o nome de quem levou. Ficavam presas
  // para sempre.
  .refine((v) => resolvePlasticCrateQty(v) === 0 || Boolean(v.customerName?.trim()), {
    message: "Informe o cliente para controlar as caixas plásticas",
    path: ["customerName"],
  })
  // Fiado em qualquer PARCELA também exige cliente: a parte fiada vira conta a
  // receber, e conta a receber sem nome não é cobrável.
  .refine(
    (v) =>
      !v.payments?.some((p) => p.method === "FIADO") ||
      (v.customerName && v.customerName.length > 0),
    { message: "Informe o cliente: parte da venda é fiada", path: ["customerName"] },
  )
  .refine((v) => v.items.every((i) => (i.discountAmount ?? 0) <= brutoDoItem(i)), {
    message: "O desconto do item não pode passar do valor dele",
    path: ["items"],
  })
  .refine((v) => paraCentavos(v.discountAmount ?? 0) <= somaDasLinhasCents(v) + TOLERANCIA_CENTAVOS_BIG, {
    message: "O desconto não pode passar do total da venda",
    path: ["discountAmount"],
  })
  .refine(
    (v) => {
      if (!v.payments || v.payments.length === 0) return true;
      const diferenca = somaParcelasCents(v.payments) - totalDaVendaCents(v);
      const absoluta = diferenca < 0n ? -diferenca : diferenca;
      return absoluta <= TOLERANCIA_CENTAVOS_BIG;
    },
    {
      message: "A soma das formas de pagamento tem de fechar com o total da venda",
      path: ["payments"],
    },
  )
  // ── Troco ───────────────────────────────────────────────────────────────
  // Só há troco quando alguma parte foi paga em espécie.
  .refine((v) => v.amountReceived == null || parteEmDinheiroCents(v) > 0n, {
    message: "Só há troco quando parte da venda é paga em dinheiro",
    path: ["amountReceived"],
  })
  // O recebido é conferido contra a PARTE EM DINHEIRO, nunca contra o total.
  .refine(
    (v) =>
      v.amountReceived == null ||
      paraCentavos(v.amountReceived) + TOLERANCIA_CENTAVOS_BIG >= parteEmDinheiroCents(v),
    {
      message: "O valor recebido é menor que a parte paga em dinheiro",
      path: ["amountReceived"],
    },
  )
  .refine(
    (v) => {
      if (v.amountReceived == null) return true;
      const emEspecie = parteEmDinheiroCents(v);
      const troco = paraCentavos(v.amountReceived) - emEspecie;
      const teto = emEspecie > TROCO_MAXIMO_CENTS ? emEspecie : TROCO_MAXIMO_CENTS;
      return troco <= teto;
    },
    {
      message: "O valor recebido parece digitado errado: o troco ficaria alto demais.",
      path: ["amountReceived"],
    },
  )
  .refine((v) => v.permitirPrecoZero || v.items.every((i) => i.unitPrice > 0), {
    message: "Há item com preço zero. Confirme para registrar assim.",
    path: ["items"],
  });

/** Cancelamento de venda — o motivo fica na auditoria. */
export const cancelarVendaSchema = z.object({
  id: z.string().min(1),
  motivo: z.string().trim().max(200).nullable().optional(),
});
export type CancelarVendaInput = z.infer<typeof cancelarVendaSchema>;

export const vendaFiltroPresetEnum = z.enum(["hoje", "semana", "mes", "todas"]);
export type VendaFiltroPreset = z.infer<typeof vendaFiltroPresetEnum>;

/** Filtros do histórico de vendas. */
export const vendaFiltroSchema = z.object({
  preset: vendaFiltroPresetEnum.optional(),
  q: z.string().trim().min(1).max(120).optional(),
  paymentMethod: paymentMethodEnum.optional(),
  /** Incluir as vendas canceladas na listagem. */
  incluirCanceladas: z.boolean().optional(),
});
export type VendaFiltro = z.infer<typeof vendaFiltroSchema>;
