import { ehUfValida } from "@/lib/constants";
import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "E-mail invalido") // limite de endereço da RFC 5321
  .email("E-mail invalido");

/**
 * O teto de 128 caracteres existe para que nenhuma entrada não confiável chegue
 * sem limite ao Argon2 nem ao banco. O custo do Argon2 é dominado pelos
 * parâmetros de memória, não pelo tamanho da entrada, então isto é contenção de
 * superfície — não a defesa principal.
 */
const MAX_SENHA = 128;

export const passwordPolicy = z
  .string()
  .min(8, "A senha deve ter ao menos 8 caracteres")
  .max(MAX_SENHA, `A senha deve ter no maximo ${MAX_SENHA} caracteres`)
  .regex(/[A-Za-z]/, "A senha deve conter ao menos uma letra")
  .regex(/[0-9]/, "A senha deve conter ao menos um numero");

export const loginSchema = z.object({
  email: emailSchema,
  // No login não se aplica a política (senhas antigas podem não atendê-la), mas
  // o teto de tamanho vale: aqui a entrada é de quem não está autenticado.
  password: z.string().min(1, "Informe a senha").max(MAX_SENHA, "Senha invalida"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotSchema = z.object({
  email: emailSchema,
});
export type ForgotInput = z.infer<typeof forgotSchema>;

export const resetSchema = z.object({
  token: z.string().min(10, "Token invalido"),
  password: passwordPolicy,
});
export type ResetInput = z.infer<typeof resetSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Informe a senha atual"),
  newPassword: passwordPolicy,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/**
 * Cadastro público (7 dias de teste): E-MAIL E SENHA, e nada mais.
 *
 * Antes daqui saíam também nome do negócio, telefone e tipo de estabelecimento.
 * Todo campo a mais é gente que não termina — e nenhum dos três é necessário
 * para criar a conta, mandar o e-mail de confirmação ou liberar o teste. Eles
 * passaram para Configurações, onde a pessoa preenche quando quiser; o cartão do
 * Início lembra, e o aviso de `/assinatura` avisa antes de o nome sair no
 * comprovante do pagamento.
 *
 * O que preenche as colunas NOT NULL enquanto isso está em
 * `src/lib/tenant-defaults.ts`, num lugar só.
 *
 * Os tetos de tamanho continuam explícitos: esta é entrada de quem não está
 * autenticado, na rota mais exposta do sistema.
 */
export const signupSchema = z.object({
  email: emailSchema,
  password: passwordPolicy,
  /**
   * Estado e central do CEASA — os dois OPCIONAIS.
   *
   * São dois `<select>`, não campos de digitação: o custo para quem se cadastra é
   * um toque cada, não uma linha a mais para preencher. Por isso cabem aqui sem
   * desfazer a decisão do cadastro mínimo — e o que se ganha é grande, porque a
   * central é o que faz o módulo de Cotações funcionar já no primeiro acesso, em
   * vez de mostrar tela vazia até alguém achar a configuração.
   *
   * Opcionais porque o cadastro não pode travar por causa deles: quem não sabe,
   * não escolhe, e completa depois em Configurações. `ceasaCentralCode` é
   * conferido contra o banco no serviço, não aqui — validação assíncrona no
   * caminho de aquisição é risco sem retorno.
   */
  /*
    `.nullable()` além de `.optional()`, e isto NÃO é redundância.

    `optional` aceita a chave ausente; `nullable` aceita a chave presente com
    `null`. Sem o segundo, um cliente que mandasse `{"uf": null}` — payload
    perfeitamente comum, e o que várias bibliotecas de formulário produzem para
    campo vazio — receberia 422 e PERDERIA A CONTA por causa de um campo
    opcional. Numa rota de aquisição, isso é caro demais para se pagar por uma
    diferença de sintaxe.
  */
  uf: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === "" || ehUfValida(v), "Estado inválido")
    .nullable()
    .optional(),
  ceasaCentralCode: z.string().trim().max(20).nullable().optional(),
});
export type SignupInput = z.infer<typeof signupSchema>;
