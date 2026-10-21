import * as Sentry from "@sentry/nextjs";
import { dsnDoServidor, opcoesBase } from "@/lib/observabilidade/sentry";

/**
 * Instrumentação do servidor (Next 16: `src/instrumentation.ts`). Só liga o
 * Sentry quando há DSN — ver `src/lib/observabilidade/sentry.ts`.
 */
export function register() {
  const dsn = dsnDoServidor();
  if (!dsn) return;
  // Mesmo `init` no Node e no Edge (o `proxy.ts`): o pacote escolhe o SDK
  // certo pelo runtime em que este arquivo foi empacotado.
  Sentry.init(opcoesBase(dsn));
}

/** Erro que escapou de Server Component, Route Handler ou Server Action. */
export const onRequestError = Sentry.captureRequestError;
