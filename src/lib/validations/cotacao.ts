import { z } from "zod";
import {
  VARIACAO_MAXIMA_ACEITA,
  VARIACAO_MINIMA_ACEITA,
} from "@/lib/cotacoes/alerta";
import { endOfDayTz, parseIsoDateTz } from "@/lib/tz";

/** Central escolhida pela empresa. `null` = voltar a não ter central. */
export const escolherCentralSchema = z.object({
  centralCode: z.string().trim().min(1).max(20).nullable(),
});
export type EscolherCentralInput = z.infer<typeof escolherCentralSchema>;

/**
 * A embalagem do vínculo.
 *
 * SEM `.min(1)`, e é decisão: `""` é uma embalagem real do boletim (a praça
 * manual grava assim quando o boletim não traz a coluna), e exigir um caractere
 * recusaria justamente o vínculo à linha sem embalagem. `null` e ausente
 * significam "qualquer embalagem" — os três estados são distintos e chegam
 * distintos ao serviço.
 *
 * `.trim()` é seguro porque a entrada já vem trimada dos dois caminhos de
 * gravação (`ceasaminas.ts` e `lerCsvDeCotacoes`), então nenhuma unidade no banco
 * tem espaço nas pontas para o trim comer.
 */
const unidadeDoVinculo = z.string().trim().max(40).nullable().optional();

export const vincularSchema = z.object({
  productId: z.string().min(1, "Informe o produto"),
  ceasaProductId: z.string().min(1, "Escolha a cotação correspondente"),
  unit: unidadeDoVinculo,
});
export type VincularInput = z.infer<typeof vincularSchema>;

/**
 * Confirmação de vários vínculos de uma vez.
 *
 * O teto de 200 não é o número de produtos que alguém tem — é o que impede um
 * lote absurdo de virar uma transação que segura conexão do pool. Quem tiver
 * mais que isso confirma em duas rodadas, e a tela continua funcionando.
 */
export const vincularEmLoteSchema = z.object({
  itens: z
    .array(
      z.object({
        productId: z.string().min(1, "Informe o produto"),
        ceasaProductId: z.string().min(1, "Escolha a cotação correspondente"),
        unit: unidadeDoVinculo,
      }),
    )
    .min(1, "Marque ao menos um produto")
    .max(200, "Confirme no máximo 200 produtos por vez"),
});
export type VincularEmLoteInput = z.infer<typeof vincularEmLoteSchema>;

export const desvincularSchema = z.object({
  productId: z.string().min(1, "Informe o produto"),
});
export type DesvincularInput = z.infer<typeof desvincularSchema>;

/**
 * Boletim enviado pelo cliente (praça sem busca automática).
 *
 * A recusa de data futura é a MESMA do envio pelo super-admin, e pela mesma
 * razão: a tela do cliente mostra o boletim de `MAX(quoteDate)`, então uma data
 * futura viraria "o mais recente" e passaria a ser o preço exibido para todos os
 * clientes daquela praça — indefinidamente, já que nenhum boletim real a
 * superaria. Aqui a validação importa ainda mais que lá, porque quem digita não
 * é o operador da plataforma.
 */
export const enviarBoletimSchema = z.object({
  quoteDate: z
    .string()
    .trim()
    .refine((v) => parseIsoDateTz(v) !== null, "Data inválida (use o seletor de data)")
    .refine((v) => {
      const d = parseIsoDateTz(v);
      return d !== null && d.getTime() <= endOfDayTz(new Date()).getTime();
    }, "O boletim não pode ter data futura"),
  texto: z.string().min(1, "Cole o boletim").max(500_000, "Texto grande demais"),
});
export type EnviarBoletimInput = z.infer<typeof enviarBoletimSchema>;

/**
 * Alerta de flutuação: "me avise se este item subir ou cair mais de X%".
 *
 * O limiar tem PISO e TETO na validação, e os dois existem por motivo de
 * produto, não de tipo:
 *
 * - Abaixo de 0,5% o "movimento" é o arredondamento de centavos do boletim
 *   (R$ 0,02 em R$ 5,00 dá 0,4%). Aceitar 0,1% entregaria um alerta que toca
 *   todo dia por ruído — e alarme que toca todo dia é desligado numa semana.
 * - Acima de 200% o alerta nunca tocaria, e seria um botão morto na tela.
 *
 * `coerce` porque os três campos vêm de `<input type="number">`, que entrega
 * string. Teto e piso aceitam vazio: alerta só por variação é o caso comum.
 */
export const salvarAlertaSchema = z
  .object({
    ceasaProductId: z.string().min(1, "Escolha o produto"),
    /** A unidade vazia é válida no banco (`unit` é NOT NULL com default ""). */
    unit: z.string().trim().max(40),
    variacaoMinima: z.coerce
      .number()
      .min(VARIACAO_MINIMA_ACEITA, `Use no mínimo ${VARIACAO_MINIMA_ACEITA}%`)
      .max(VARIACAO_MAXIMA_ACEITA, `Use no máximo ${VARIACAO_MAXIMA_ACEITA}%`),
    precoTeto: z.coerce.number().positive().nullable().optional().default(null),
    precoPiso: z.coerce.number().positive().nullable().optional().default(null),
  })
  .refine(
    (v) => v.precoTeto === null || v.precoPiso === null || v.precoPiso < v.precoTeto,
    // Piso acima do teto faria os dois avisos dispararem em todo boletim.
    { message: "O piso precisa ser menor que o teto", path: ["precoPiso"] },
  );
export type SalvarAlertaInput = z.infer<typeof salvarAlertaSchema>;

export const removerAlertaSchema = z.object({
  ceasaProductId: z.string().min(1),
  unit: z.string().trim().max(40),
});
export type RemoverAlertaInput = z.infer<typeof removerAlertaSchema>;
