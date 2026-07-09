import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email("E-mail invalido");

export const passwordPolicy = z
  .string()
  .min(8, "A senha deve ter ao menos 8 caracteres")
  .regex(/[A-Za-z]/, "A senha deve conter ao menos uma letra")
  .regex(/[0-9]/, "A senha deve conter ao menos um numero");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Informe a senha"),
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
