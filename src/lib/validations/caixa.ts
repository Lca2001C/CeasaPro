import { z } from "zod";

/**
 * Teto de caixas por lançamento. Um número colado por engano (1.500.000.000)
 * passava, e a SOMA do livro-razão estourava no banco — o módulo inteiro parava,
 * inclusive o cancelamento que corrigiria o lançamento. Mesmo motivo do
 * `QTD_MAX` das embalagens; nenhum box movimenta cem mil caixas de uma vez.
 */
export const CAIXAS_MAX = 100_000;
export const CAIXAS_MAX_MSG = "Quantidade de caixas muito alta — confira o número";

/**
 * Tipos que o formulário "Movimentar caixas" pode lançar À MÃO.
 *
 * Ficam de fora, de propósito:
 *  - `ESTORNO_SAIDA` — só o cancelamento de venda cria;
 *  - `SAIDA_HIGIENIZACAO` / `RETORNO_HIGIENIZACAO` — só o lote de higienização
 *    cria, ligado a ele. Lançados soltos, mexiam no pote "com o higienizador"
 *    sem o lote saber: o lote passava a recusar a própria devolução ("Há 0
 *    caixa(s) no higienizador") e ficava ENVIADO para sempre.
 *
 * O `<select>` da tela é montado a partir destas opções, então o que a tela
 * oferece é exatamente o que o servidor aceita.
 */
export const caixaMovimentoTipoEnum = z.enum(["ENTRADA", "SAIDA", "RETORNO", "QUEBRA"]);

export const caixaMovimentoSchema = z
  .object({
    type: caixaMovimentoTipoEnum,
    quantity: z.number().int().positive("Quantidade inválida").max(CAIXAS_MAX, CAIXAS_MAX_MSG),
    brokenQty: z.number().int().nonnegative().max(CAIXAS_MAX, CAIXAS_MAX_MSG).optional(), // só na ENTRADA
    dirty: z.boolean().optional(), // ENTRADA/QUEBRA: caixa suja (aguardando higienização)
    customerName: z.string().trim().max(120).nullable().optional(),
    supplierName: z.string().trim().max(120).nullable().optional(),
    // Mantido no tipo porque os serviços (lote de higienização) o usam; no
    // lançamento manual é recusado pelo refine abaixo.
    cleanerName: z.string().trim().max(120).nullable().optional(),
    movementDate: z.string().min(1, "Informe a data"),
    notes: z.string().trim().max(300).nullable().optional(),
  })
  .refine(
    (v) =>
      (v.type !== "SAIDA" && v.type !== "RETORNO") ||
      (v.customerName && v.customerName.length > 0),
    { message: "Informe o cliente", path: ["customerName"] },
  )
  .refine((v) => !v.cleanerName, {
    // Perda no higienizador lançada aqui não fica ligada ao lote — ver o
    // comentário do enum acima.
    message: "Caixa perdida no higienizador se registra no próprio envio, em Higienização.",
    path: ["cleanerName"],
  })
  .refine((v) => v.type !== "ENTRADA" || (v.brokenQty ?? 0) <= v.quantity, {
    // A quantidade é o TOTAL recebido; as quebradas são parte dele.
    message: "As quebradas não podem passar do total de caixas recebidas.",
    path: ["brokenQty"],
  });
export type CaixaMovimentoInput = z.infer<typeof caixaMovimentoSchema>;
