import { z } from "zod";
import { recipientTypeEnum } from "./produto";

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
   * Lançar o frete como despesa operacional.
   *
   * Frete é a despesa mais comum do CEASA e vivia fora do módulo de despesas:
   * quem queria vê-la no fluxo de caixa lançava à mão — às vezes duas vezes.
   * Opcional porque o frete já entra no custo do produto; a despesa é para
   * quem também controla a saída de caixa.
   */
  lancarFreteComoDespesa: z.boolean().optional(),
});
export type CompraInput = z.infer<typeof compraSchema>;
