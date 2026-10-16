import { z } from "zod";
import { recipientTypeEnum } from "./produto";
import { expensePaymentMethodEnum } from "./despesa";

export const compraItemSchema = z.object({
  productId: z.string().min(1, "Selecione o produto"),
  quantity: z.number().positive("Quantidade inválida"),
  unitPrice: z.number().nonnegative("Preço inválido"),
  recipientType: recipientTypeEnum.nullable().optional(),
  suggestedSalePrice: z.number().nonnegative().nullable().optional(),
});

export const compraSchema = z.object({
  supplierId: z.string().nullable().optional(),
  purchaseDate: z.string().min(1, "Informe a data"),
  freight: z.number().nonnegative(),
  notes: z.string().max(500).nullable().optional(),
  items: z.array(compraItemSchema).min(1, "Adicione ao menos um item"),
  /**
   * Caixas plásticas que chegaram junto com a mercadoria.
   *
   * Sem isto o operador lançava a compra e ia movimentar caixa em OUTRA tela —
   * dois passos para um fato só, e a segunda metade era esquecida com
   * frequência. Opcional: nem toda compra vem em caixa plástica.
   */
  caixasRecebidas: z.number().int().nonnegative().optional(),
  /** Chegaram sujas? Vão direto para a fila de higienização. */
  caixasSujas: z.boolean().optional(),
  /** Quantas já vieram quebradas — entram como perda, não como estoque. */
  caixasQuebradas: z.number().int().nonnegative().optional(),
  /**
   * Como a compra foi paga. Toda compra vira UMA despesa (`origem = COMPRA`)
   * no valor total — itens + frete —, ligada ao fornecedor:
   *
   * - `PAGO`: saiu do caixa no dia da compra (`paidDate = purchaseDate`).
   * - `PENDENTE`: comprou a prazo; vai para Contas a Pagar até `dueDate`.
   *
   * Ausente = paga na hora (o comportamento de antes desta opção existir).
   */
  pagamento: z
    .object({
      status: z.enum(["PAGO", "PENDENTE"]),
      paymentMethod: expensePaymentMethodEnum.nullable().optional(),
      dueDate: z.string().trim().nullable().optional(),
    })
    .refine((p) => p.status !== "PENDENTE" || Boolean(p.dueDate), {
      path: ["dueDate"],
      message: "Informe até quando vai pagar",
    })
    .optional(),
  /** Uma por compra digitada: o reenvio devolve a compra já gravada. */
  idempotencyKey: z.uuid().optional(),
});
export type CompraInput = z.infer<typeof compraSchema>;
