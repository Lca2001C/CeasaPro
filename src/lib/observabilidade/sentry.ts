import * as Sentry from "@sentry/nextjs";
import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";

/**
 * Rastreamento de erros (Sentry) — DESLIGADO sem DSN.
 *
 * O DSN vem do ambiente: `SENTRY_DSN` no servidor e `NEXT_PUBLIC_SENTRY_DSN`
 * no navegador (o mesmo valor). Sem eles, `Sentry.init` nem é chamado e
 * `capturarErro` não faz nada — dev local e testes seguem como antes.
 *
 * Só erros. Sem tracing (`tracesSampleRate: 0`) e sem replay: o custo do app é
 * o número de idas ao banco por tela (briefing §13b), e o que falta hoje é
 * SABER que o PDV quebrou, não medir latência.
 *
 * Sem dado de cliente no evento ({@link SEM_DADOS_PESSOAIS}): o padrão do SDK
 * coleta cookies, cabeçalhos, corpos de requisição (a senha do login, o
 * carrinho do PDV), parâmetros de consulta ao banco e variáveis locais da
 * pilha. Aqui, só a mensagem e a pilha do erro.
 */

/** Desliga toda coleta de dado de requisição/cliente. Usado no servidor e no navegador. */
export const SEM_DADOS_PESSOAIS: NonNullable<Parameters<typeof Sentry.init>[0]["dataCollection"]> = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
};

/**
 * Caminhos que carregam um SEGREDO na própria URL: o link de redefinição de
 * senha (válido por 1 h) e o de confirmação de e-mail. `urlQueryParams: false`
 * só limpa a query — o token está no caminho, e iria para o Sentry em todo
 * erro nessas telas (e nos breadcrumbs de navegação do navegador).
 */
const CAMINHO_COM_TOKEN = /\/(recuperar-senha|cadastro\/confirmar)\/[^/?#\s]+/g;

export function semTokenNaUrl<T extends string | undefined>(url: T): T {
  return (url ? url.replace(CAMINHO_COM_TOKEN, "/$1/:token") : url) as T;
}

/** `beforeSend` comum (servidor e navegador): nenhum token de URL sai daqui. */
export function limparEvento(event: ErrorEvent): ErrorEvent {
  if (event.request?.url) event.request.url = semTokenNaUrl(event.request.url);
  if (event.transaction) event.transaction = semTokenNaUrl(event.transaction);
  for (const b of event.breadcrumbs ?? []) limparBreadcrumb(b);
  // O erro do Prisma que escapa pelo `onRequestError` chega com a mensagem
  // inteira (argumentos da consulta). Fica só o tipo.
  for (const ex of event.exception?.values ?? []) {
    if (ex.type?.startsWith("PrismaClient")) ex.value = ex.type;
  }
  return event;
}

/** `beforeBreadcrumb`: navegação e fetch carregam a URL em `data`. */
export function limparBreadcrumb(b: Breadcrumb): Breadcrumb {
  if (b.message) b.message = semTokenNaUrl(b.message);
  if (b.data) {
    for (const chave of ["url", "to", "from"] as const) {
      const v = b.data[chave];
      if (typeof v === "string") b.data[chave] = semTokenNaUrl(v);
    }
  }
  return b;
}

/**
 * Erro do Prisma imprime na `message` os ARGUMENTOS da consulta (nomes,
 * e-mails, hashes). Para o Sentry vai só o tipo e o código — a pilha continua
 * dizendo onde foi.
 */
function semDadosDoPrisma(e: unknown): unknown {
  const nome = (e as { name?: unknown } | null)?.name;
  if (typeof nome !== "string" || !nome.startsWith("PrismaClient")) return e;
  const codigo = (e as { code?: unknown }).code;
  const limpo = new Error(`${nome}${typeof codigo === "string" ? ` ${codigo}` : ""}`);
  limpo.name = nome;
  limpo.stack = (e as Error).stack?.split("\n").filter((l) => l.trimStart().startsWith("at ")).join("\n");
  return limpo;
}

export function dsnDoServidor(): string | undefined {
  return process.env.SENTRY_DSN?.trim() || process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() || undefined;
}

export function opcoesBase(dsn: string) {
  return {
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: 0,
    dataCollection: SEM_DADOS_PESSOAIS,
    beforeSend: limparEvento,
    beforeBreadcrumb: limparBreadcrumb,
  };
}

/**
 * Registra no Sentry um erro INESPERADO que o envelope transformou em resposta
 * (500 / "erro inesperado (ref: …)"). Erro devolvido como resposta não chega ao
 * `onRequestError` do Next — sem isto, justamente a falha que o cliente vê com
 * um código de referência nunca apareceria no painel.
 */
export function capturarErro(e: unknown, errorId: string): void {
  try {
    Sentry.captureException(semDadosDoPrisma(e), { tags: { errorId } });
  } catch {
    // Observabilidade nunca derruba a requisição.
  }
}
