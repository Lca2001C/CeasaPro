import { z } from "zod";

/**
 * CNPJ opcional — em branco tem de virar `null`, nunca `""`.
 *
 * A coluna é `@unique` e GLOBAL. NULL repete à vontade; string vazia, não.
 * Como o formulário manda `""` quando o campo fica em branco e `?? null` só
 * troca null/undefined, a primeira empresa salva sem CNPJ ocupava a string
 * vazia no índice — e toda outra que salvasse os dados da própria empresa
 * batia em P2002, que chega na tela como "Ocorreu um erro inesperado", para
 * sempre. Convertendo aqui, os três pontos de escrita ficam cobertos.
 */
export const cnpjSchema = z
  .string()
  .trim()
  .max(20)
  .transform((v) => v || null)
  .nullable()
  .optional();

export const empresaSchema = z.object({
  tradeName: z.string().trim().min(1, "Informe o nome").max(120),
  legalName: z.string().trim().max(160).nullable().optional(),
  cnpj: cnpjSchema,
  phone: z.string().trim().max(20).nullable().optional(),
  address: z.string().trim().max(200).nullable().optional(),
  businessHours: z.string().trim().max(120).nullable().optional(),
});
export type EmpresaInput = z.infer<typeof empresaSchema>;
