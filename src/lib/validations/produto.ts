import { z } from "zod";
import {
  MSG_QUANTIDADE_MAX,
  MSG_TRES_CASAS,
  MSG_VALOR_MAX,
  QUANTIDADE_MAX,
  VALOR_MAX,
  temAteQuatroCasas,
  temAteTresCasas,
} from "./quantidade";

export const saleUnitEnum = z.enum(["CAIXA", "KG", "SACO", "BANDEJA", "UNIDADE"]);
export const recipientTypeEnum = z.enum(["PLASTICA", "PAPELAO", "MADEIRA"]);

const camposDoProduto = {
  name: z.string().trim().min(1, "Informe o nome do produto").max(120),
  saleUnit: saleUnitEnum,
  qtyPerRecipient: z.number().positive("Valor inválido").nullable().optional(),
  recipientType: recipientTypeEnum.nullable().optional(),
  sackCapacity: z.number().positive("Valor inválido").nullable().optional(),
  active: z.boolean(),
  /** Preço de venda cadastrado — o primeiro preço sugerido no PDV. */
  salePrice: z.number().nonnegative("Valor inválido").max(9_999_999).nullable().optional(),
  /** Alerta de estoque do produto. Vazio = limite padrão do sistema. */
  minStock: z.number().nonnegative("Valor inválido").max(9_999_999).nullable().optional(),
  /** Chave da foto no R2. O servidor confere de quem ela é (`ProdutosService`). */
  imageKey: z.string().trim().min(1).max(300).nullable().optional(),
};

export const produtoSchema = z
  .object({
    ...camposDoProduto,
    /**
     * Quanto já tem no box no dia do cadastro. Vira um movimento de ENTRADA
     * (`sourceType: "ESTOQUE_INICIAL"`) na mesma transação do produto.
     */
    // Os mesmos limites da compra e do ajuste (`quantidade.ts`): 3 casas e o
    // teto de quantidade. Mais casas o banco arredondava sem aviso.
    estoqueInicial: z
      .number()
      .nonnegative("Valor inválido")
      .max(QUANTIDADE_MAX, MSG_QUANTIDADE_MAX)
      .refine(temAteTresCasas, MSG_TRES_CASAS)
      .nullable()
      .optional(),
    /**
     * Custo por unidade do estoque inicial. Obrigatório quando há estoque:
     * sem ele, a entrada valeria R$ 0 e o lucro das primeiras vendas sairia
     * inflado — o custo médio do estoque é o CMV da venda.
     */
    custoInicial: z
      .number()
      .nonnegative("Valor inválido")
      .max(VALOR_MAX, MSG_VALOR_MAX)
      .refine(temAteQuatroCasas, "Use no máximo 4 casas decimais")
      .nullable()
      .optional(),
  })
  .refine((v) => !(v.estoqueInicial && v.estoqueInicial > 0) || v.custoInicial != null, {
    path: ["custoInicial"],
    message: "Informe quanto custou cada unidade do estoque inicial",
  });
export type ProdutoInput = z.infer<typeof produtoSchema>;

/** Edição: o estoque inicial só existe no cadastro. Depois, compra ou ajuste. */
export const produtoUpdateSchema = z.object({
  ...camposDoProduto,
  id: z.string().min(1),
});
export type ProdutoUpdateInput = z.infer<typeof produtoUpdateSchema>;

export const idSchema = z.object({ id: z.string().min(1) });

/** Foto já comprimida no aparelho, em base64 (sem o prefixo `data:`). */
export const fotoProdutoSchema = z.object({
  // ~1 MB de arquivo dá ~1,37 MB em base64; o teto exato é conferido nos bytes.
  base64: z.string().min(16).max(1_500_000),
});
export type FotoProdutoInput = z.infer<typeof fotoProdutoSchema>;
