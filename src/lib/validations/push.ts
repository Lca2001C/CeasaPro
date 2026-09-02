import { z } from "zod";

/**
 * Inscrição de push vinda do navegador.
 *
 * Validada com o mesmo rigor de qualquer entrada externa, mesmo sendo de usuário
 * autenticado: o corpo é montado no cliente e o `endpoint` é a chave única da
 * tabela — lixo aqui viraria linha permanente que o cron tentaria todo dia.
 *
 * O endpoint precisa ser HTTPS: os serviços de push (FCM, Mozilla, WNS) só operam
 * assim, e aceitar `http://` abriria caminho para usar o servidor como cliente de
 * um endereço arbitrário (SSRF a partir do cron).
 */
export const pushSubscribeSchema = z.object({
  endpoint: z
    .string()
    .url("Endpoint invalido")
    .max(2048, "Endpoint muito longo")
    .refine((v) => v.startsWith("https://"), "Endpoint precisa ser https"),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(128),
  }),
});
export type PushSubscribeInput = z.infer<typeof pushSubscribeSchema>;

export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url("Endpoint invalido").max(2048),
});
export type PushUnsubscribeInput = z.infer<typeof pushUnsubscribeSchema>;
