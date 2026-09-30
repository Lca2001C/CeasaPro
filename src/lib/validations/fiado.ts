import { z } from "zod";
import { dataDoFormularioValida, dataOpcionalSchema, vendaItemSchema } from "./venda";

export const pagamentoFiadoSchema = z.object({
  accountId: z.string().min(1),
  // Dinheiro tem 2 casas. 10,005 sobre um saldo de 10,01 gravava 10,01 pago e
  // deixava a conta EM_ABERTO com saldo zero para sempre.
  amount: z
    .number()
    .positive("Informe o valor")
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "Use no máximo 2 casas decimais"),
  method: z.enum(["PIX", "DINHEIRO", "CARTAO"]),
});
export type PagamentoFiadoInput = z.infer<typeof pagamentoFiadoSchema>;

/** Data obrigatória de formulário que EXISTE ("2026-02-31" não passa). */
const dataObrigatoria = (mensagem: string) =>
  z
    .string()
    .min(1, mensagem)
    .refine(dataDoFormularioValida, "Data inválida. Use o seletor de data.");

/**
 * Lançamento manual de uma venda fiada (venda que não passou pelo PDV).
 *
 * Todo item precisa de preço. O formulário abre a linha com preço 0, e o
 * esquecimento é o caso comum. Com a venda inteira a R$ 0 nenhuma conta a
 * receber nasce (não há o que cobrar), mas a venda, a baixa de estoque e a
 * saída de caixas eram gravadas mesmo assim, e a tela respondia erro. Cada
 * nova tentativa baixava o estoque de novo. Com só UM item zerado, a venda
 * passava sem a confirmação de preço zero que o PDV exige
 * (`permitirPrecoZero`). Aqui não há confirmação: fiado de brinde não é
 * fiado.
 */
export const fiadoManualSchema = z.object({
  customerName: z.string().trim().min(1, "Informe o cliente").max(120),
  customerPhone: z.string().trim().max(20).nullable().optional(),
  saleDate: dataObrigatoria("Informe a data da venda"),
  dueDate: dataOpcionalSchema,
  plasticCrateQty: z.number().int().nonnegative("Quantidade de caixas inválida").optional(),
  notes: z.string().trim().max(300).nullable().optional(),
  items: z
    .array(vendaItemSchema)
    .min(1, "Adicione ao menos um item")
    .refine((itens) => itens.every((i) => i.unitPrice > 0), "Informe o preço de todos os itens."),
});
export type FiadoManualInput = z.infer<typeof fiadoManualSchema>;

/** Só dados cadastrais — valores nunca são editados aqui. */
export const fiadoUpdateSchema = z.object({
  id: z.string().min(1),
  customerPhone: z.string().trim().max(20).nullable().optional(),
  dueDate: dataOpcionalSchema,
  notes: z.string().trim().max(300).nullable().optional(),
});
export type FiadoUpdateInput = z.infer<typeof fiadoUpdateSchema>;

export const devolucaoCaixasSchema = z.object({
  accountId: z.string().min(1),
  quantity: z.number().int().positive("Quantidade inválida"),
  movementDate: dataObrigatoria("Informe a data"),
  notes: z.string().trim().max(300).nullable().optional(),
});
export type DevolucaoCaixasInput = z.infer<typeof devolucaoCaixasSchema>;

export const fiadoStatusFiltroEnum = z.enum(["EM_ABERTO", "PAGO", "TODAS"]);
export type FiadoStatusFiltro = z.infer<typeof fiadoStatusFiltroEnum>;
