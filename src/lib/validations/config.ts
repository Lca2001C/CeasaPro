import { z } from "zod";

/**
 * Dados da empresa.
 *
 * Todo campo além do nome é `.optional()` de propósito, e isso agora tem
 * consequência: `ConfigService.updateCompany` trata chave AUSENTE como "não
 * mexer" e `null`/`""` como "limpar". Antes as duas coisas eram a mesma, e um
 * formulário parcial apagava o resto.
 */
export const empresaSchema = z.object({
  tradeName: z.string().trim().min(1, "Informe o nome").max(120),
  legalName: z.string().trim().max(160).nullable().optional(),
  cnpj: z.string().trim().max(20).nullable().optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  address: z.string().trim().max(200).nullable().optional(),
  businessHours: z.string().trim().max(120).nullable().optional(),
  /**
   * Saiu do cadastro público (que passou a pedir só e-mail e senha) e passou a
   * morar aqui. Teto de 60 é o mesmo que o cadastro usava — mudar agora deixaria
   * inválido o que já foi gravado.
   */
  establishmentType: z.string().trim().max(60, "Descricao muito longa").nullable().optional(),
});
export type EmpresaInput = z.infer<typeof empresaSchema>;

/**
 * Nome de quem usa o sistema — a PESSOA, não a empresa.
 *
 * Este é o nome que vai no cabeçalho e no `payerName` do pagamento. Com o
 * cadastro mínimo ele nasce derivado do e-mail, então precisa ter onde ser
 * corrigido.
 */
export const perfilSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome").max(120, "Nome muito longo"),
});
export type PerfilInput = z.infer<typeof perfilSchema>;
