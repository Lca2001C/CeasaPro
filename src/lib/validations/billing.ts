import { z } from "zod";
import { emailSchema } from "./auth";

/** Espelha o enum `ChargeMethod` do Prisma. */
export const chargeMethodEnum = z.enum(["PIX", "CREDIT_CARD", "DEBIT_CARD"]);

/** Subconjunto que passa pelo Card Brick (token + bandeira). */
export const cardMethodEnum = z.enum(["CREDIT_CARD", "DEBIT_CARD"]);

/** CPF/CNPJ do pagador — exigido pelos emissores brasileiros no débito. */
export const identificationSchema = z.object({
  type: z.enum(["CPF", "CNPJ"]),
  number: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v.length === 11 || v.length === 14, "CPF/CNPJ invalido"),
});

export const payerSchema = z.object({
  email: emailSchema,
  firstName: z.string().trim().max(60).optional(),
  lastName: z.string().trim().max(60).optional(),
  identification: identificationSchema.optional(),
});

/** Cobrança da mensalidade sem cartão (hoje só PIX). `planId` troca o plano no ato. */
export const checkoutSchema = z.object({
  method: chargeMethodEnum.default("PIX"),
  planId: z.string().min(1).optional(),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const cardPaymentSchema = z
  .object({
    method: cardMethodEnum,
    /** Token do Card Brick — o servidor nunca recebe número/CVV (PCI). */
    token: z.string().min(1),
    paymentMethodId: z.string().min(1),
    issuerId: z.string().min(1).optional(),
    installments: z.number().int().positive().max(12).default(1),
    payer: payerSchema,
    planId: z.string().min(1).optional(),
  })
  .refine((v) => v.method !== "DEBIT_CARD" || v.installments === 1, {
    message: "Cartao de debito nao permite parcelamento",
    path: ["installments"],
  });
export type CardPaymentInput = z.infer<typeof cardPaymentSchema>;

/** Resposta de `/api/billing/checkout/card` — contrato compartilhado com a UI. */
export interface CardPaymentResult {
  status: string;
  statusDetail: string | null;
  mpPaymentId: string | null;
  referenceMonth: string;
  /** Presente apenas quando o emissor exigiu o desafio 3DS (débito). */
  threeDsUrl: string | null;
  /** Payload do desafio 3DS, enviado por POST para `threeDsUrl` no iframe. */
  threeDsCreq: string | null;
}
