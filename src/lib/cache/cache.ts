import { logger, describeError } from "@/lib/logger";
import { clienteDeCache } from "./cliente";
import { desserializar, serializar } from "./codec";

/**
 * Cache de LEITURA no Upstash, com invalidação por versão.
 *
 * Regras (CONTEXTO-AGENTE §13b):
 *   - nunca é fonte: guarda resultado de leitura com TTL curto. Escrita, saldo
 *     de livro-razão e decisão de segurança leem do banco;
 *   - a chave carrega as versões (`v:t:<empresa>`, `v:g:cotacoes`…). Escrever
 *     incrementa a versão e as chaves antigas morrem pelo TTL — não há varredura;
 *   - fail-open: Redis lento ou fora cai no banco. O cache não derruba tela.
 */

const TETO_MS = 150;

const AMBIENTE = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "dev";
const PREFIXO = `cp:${AMBIENTE}:`;

/** Chave com o prefixo do ambiente: preview e produção podem dividir o banco Upstash. */
export function chaveDeCache(chave: string): string {
  return PREFIXO + chave;
}

export const versao = {
  /** Muda a cada escrita da empresa (wrappers, billing, admin). */
  tenant: (tenantId: string) => `v:t:${tenantId}`,
  /** Dados globais: boletim das centrais, CeasaNews, banco de fotos. */
  global: (nome: "cotacoes" | "noticias" | "catalogo") => `v:g:${nome}`,
  /** Revogação de sessão — separadas de `tenant` para venda não esfriar a sessão. */
  sessaoUsuario: (userId: string) => `v:su:${userId}`,
  sessaoTenant: (tenantId: string) => `v:st:${tenantId}`,
  /** Logout e reuso encerram só a linhagem do aparelho (`fid`). */
  sessaoFamilia: (familyId: string) => `v:sf:${familyId}`,
};

export class TempoEsgotadoNoCache extends Error {}

export function comTeto<T>(p: Promise<T>, ms = TETO_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new TempoEsgotadoNoCache(`cache: mais de ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function avisar(e: unknown, msg: string) {
  logger.warn({ err: describeError(e) }, msg);
}

/**
 * Devolve o valor guardado em `chave` + versões, ou calcula com `fn` e guarda.
 *
 * Sem Redis, ou com erro nele, é só `fn()`.
 */
export async function lembrar<T>(
  opts: { chave: string; versoes?: string[]; ttlSeg: number },
  fn: () => Promise<T>,
): Promise<T> {
  const c = clienteDeCache();
  if (!c) return fn();

  let chaveFinal: string;
  try {
    const lido = await comTeto(
      c.lerVersionado(
        chaveDeCache(opts.chave),
        (opts.versoes ?? []).map(chaveDeCache),
      ),
    );
    if (lido.valor !== null) return desserializar<T>(lido.valor);
    chaveFinal = lido.chave;
  } catch (e) {
    avisar(e, "Cache indisponível na leitura — lendo do banco");
    return fn();
  }

  const valor = await fn();
  try {
    await comTeto(c.set(chaveFinal, serializar(valor), opts.ttlSeg));
  } catch (e) {
    avisar(e, "Cache indisponível na gravação");
  }
  return valor;
}

/** Incrementa versões. Nunca lança: sem Redis, quem segura o dado velho é o TTL. */
export async function invalidar(...versoes: string[]): Promise<void> {
  const c = clienteDeCache();
  if (!c || versoes.length === 0) return;
  try {
    await comTeto(Promise.all(versoes.map((v) => c.incr(chaveDeCache(v)))));
  } catch (e) {
    avisar(e, "Não foi possível invalidar o cache");
  }
}

/** Toda escrita da empresa que não passa pelos wrappers chama isto. */
export function invalidarTenant(tenantId: string): Promise<void> {
  return invalidar(versao.tenant(tenantId));
}

export function invalidarGlobal(nome: "cotacoes" | "noticias" | "catalogo"): Promise<void> {
  return invalidar(versao.global(nome));
}

/** Pedaço estável de chave para uma lista de módulos (ordem não importa). */
export function chaveDeModulos(modules: readonly string[] | undefined): string {
  return modules && modules.length ? [...modules].sort().join(",") : "-";
}
