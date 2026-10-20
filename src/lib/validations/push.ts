import { z } from "zod";

/**
 * Inscrição de push vinda do navegador.
 *
 * Validada com o mesmo rigor de qualquer entrada externa, mesmo sendo de usuário
 * autenticado: o corpo é montado no cliente e o `endpoint` é a chave única da
 * tabela — lixo aqui viraria linha permanente que o cron tentaria todo dia.
 *
 * O endpoint precisa ser HTTPS **e de um serviço de push conhecido**. Só exigir
 * `https://` deixava qualquer dono cadastrar `https://qualquer-host/...` e fazer
 * o cron diário mandar um POST do servidor para lá (SSRF cego), com quantos
 * endpoints quisesse.
 */

/** Hosts dos serviços de push dos navegadores (o domínio e seus subdomínios). */
const SERVICOS_DE_PUSH = [
  "fcm.googleapis.com", // Chrome, Edge Android, Samsung, Opera
  "push.services.mozilla.com", // Firefox (updates.push.services.mozilla.com)
  "notify.windows.com", // Edge no Windows (*.notify.windows.com)
  "push.apple.com", // Safari / iOS (web.push.apple.com)
];

export function ehServicoDePush(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.port !== "") return false;
    const host = url.hostname.toLowerCase();
    return SERVICOS_DE_PUSH.some((s) => host === s || host.endsWith(`.${s}`));
  } catch {
    return false;
  }
}

export const pushSubscribeSchema = z.object({
  endpoint: z
    .string()
    .url("Endpoint invalido")
    .max(2048, "Endpoint muito longo")
    .refine((v) => v.startsWith("https://"), "Endpoint precisa ser https")
    .refine(ehServicoDePush, "Endpoint nao e de um servico de push conhecido"),
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
