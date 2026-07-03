import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("E-mail inválido"),
  password: z.string().min(1, "Informe a senha"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotSchema = z.object({
  email: z.string().email("E-mail inválido"),
});
export type ForgotInput = z.infer<typeof forgotSchema>;

export const resetSchema = z.object({
  token: z.string().min(10, "Token inválido"),
  password: z.string().min(6, "A senha deve ter ao menos 6 caracteres"),
});
export type ResetInput = z.infer<typeof resetSchema>;
