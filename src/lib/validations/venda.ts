import { z } from "zod";

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

/** Tolerância de centavo ao conferir a soma das formas de pagamento. */
export const TOLERANCIA_CENTAVOS = 0.005;

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
  /** Dinheiro recebido, para calcular o troco. Só faz sentido em dinheiro. */
  amountReceived: z.number().nonnegative().nullable().optional(),
  /**
   * Confirmação explícita de que um item vai com preço zero.
   *
   * Sem isto, esquecer o preço de um produto novo passava batido e a venda
   * entrava zerada — distorcendo faturamento e lucro sem ninguém perceber.
   */
  permitirPrecoZero: z.boolean().optional(),
  items: z.array(vendaItemSchema).min(1, "Adicione ao menos um item"),
});

export type VendaInput = z.infer<typeof vendaBase>;

/** Bruto da linha, antes do desconto dela. */
export function brutoDoItem(i: { quantity: number; unitPrice: number }): number {
  return i.quantity * i.unitPrice;
}

/** Total cobrado: soma das linhas (já líquidas) menos o desconto da venda. */
export function totalDaVenda(v: {
  items: { quantity: number; unitPrice: number; discountAmount?: number }[];
  discountAmount?: number;
}): number {
  const itens = v.items.reduce(
    (a, i) => a + Math.max(0, brutoDoItem(i) - (i.discountAmount ?? 0)),
    0,
  );
  return Math.max(0, itens - (v.discountAmount ?? 0));
}

export const vendaSchema = vendaBase
  .refine((v) => v.paymentMethod !== "FIADO" || (v.customerName && v.customerName.length > 0), {
    message: "Informe o cliente para venda fiada",
    path: ["customerName"],
  })
  .refine((v) => !v.plasticCrateQty || (v.customerName && v.customerName.length > 0), {
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
  .refine(
    (v) => {
      const itens = v.items.reduce(
        (a, i) => a + Math.max(0, brutoDoItem(i) - (i.discountAmount ?? 0)),
        0,
      );
      return (v.discountAmount ?? 0) <= itens + TOLERANCIA_CENTAVOS;
    },
    { message: "O desconto não pode passar do total da venda", path: ["discountAmount"] },
  )
  .refine(
    (v) => {
      if (!v.payments || v.payments.length === 0) return true;
      const soma = v.payments.reduce((a, p) => a + p.amount, 0);
      return Math.abs(soma - totalDaVenda(v)) <= TOLERANCIA_CENTAVOS;
    },
    {
      message: "A soma das formas de pagamento tem de fechar com o total da venda",
      path: ["payments"],
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
