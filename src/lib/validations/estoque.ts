import { z } from "zod";

/**
 * Ajuste manual de estoque.
 *
 * `AJUSTE` aceita quantidade NEGATIVA; `QUEBRA` e `DOACAO`, não.
 *
 * Antes tudo era `positive()`, e `AJUSTE` sempre SOMA (`IN ('ENTRADA','AJUSTE')`
 * em todas as agregações). Ou seja: não existia acerto de inventário para baixo.
 * Quem contava a prateleira e achava menos do que o sistema dizia só tinha a
 * opção de lançar "quebra" — o que mente sobre o motivo e envenena o relatório
 * de perdas.
 *
 * Representar o acerto como `AJUSTE` negativo, em vez de criar um tipo novo no
 * enum do banco, é deliberado: quantidade negativa já funciona aritmeticamente
 * em TODAS as agregações que existem (`estoque.service`, `vendas.service`,
 * `dashboard.service`, `report.service`), então não há risco de alguém esquecer
 * de classificar o tipo novo num dos lugares e o saldo divergir em silêncio.
 */
export const ajusteEstoqueSchema = z
  .object({
    productId: z.string().min(1, "Selecione o produto"),
    type: z.enum(["QUEBRA", "DOACAO", "AJUSTE"]),
    quantity: z.number().refine((v) => v !== 0, "Quantidade inválida"),
    reason: z.string().trim().max(200).nullable().optional(),
    unitCost: z.number().nonnegative().nullable().optional(),
  })
  .refine((v) => v.type === "AJUSTE" || v.quantity > 0, {
    message: "Quebra e doação são sempre uma quantidade positiva.",
    path: ["quantity"],
  });
export type AjusteEstoqueInput = z.infer<typeof ajusteEstoqueSchema>;
