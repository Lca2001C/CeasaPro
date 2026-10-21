import * as Sentry from "@sentry/nextjs";
import {
  SEM_DADOS_PESSOAIS,
  limparBreadcrumb,
  limparEvento,
} from "@/lib/observabilidade/sentry";

/**
 * Erros do navegador (o PDV quebrando no balcão) — só com
 * `NEXT_PUBLIC_SENTRY_DSN`. O envio vai direto ao Sentry, por isso o host do
 * DSN entra no `connect-src` da CSP (`src/proxy.ts`).
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();

if (dsn) {
  try {
    Sentry.init({
      dsn,
      environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
      tracesSampleRate: 0,
      dataCollection: SEM_DADOS_PESSOAIS,
      beforeSend: limparEvento,
      beforeBreadcrumb: limparBreadcrumb,
    });
  } catch {
    // Observabilidade nunca impede a tela de abrir.
  }
}
