import { Redis } from "@upstash/redis";

/**
 * O que o app pede ao Redis — em termos do app, não dos comandos.
 *
 * As operações compostas (ler versões e valor numa volta, contar na janela)
 * são atômicas no Upstash por serem um único EVAL; o fake de teste as faz em
 * JS. Ninguém fora de `src/lib/cache` fala com o Redis direto.
 */
export interface ClienteDeCache {
  /**
   * Lê as versões e, na MESMA volta, o valor da chave `base:v1:v2…`.
   * Devolve a chave composta para o `set` da falta.
   */
  lerVersionado(base: string, chavesDeVersao: string[]): Promise<{ chave: string; valor: string | null }>;
  set(chave: string, valor: string, ttlSeg: number): Promise<void>;
  incr(chave: string): Promise<void>;
  /** Soma uma unidade na janela fixa. A janela começa no primeiro incremento. */
  consumirJanela(chave: string, janelaMs: number): Promise<{ count: number; restanteMs: number }>;
  consultarJanela(chave: string): Promise<{ count: number; restanteMs: number }>;
  /** Devolve uma unidade sem descer de zero. */
  devolverUnidade(chave: string): Promise<void>;
  del(chave: string): Promise<void>;
}

/** Versão ausente vale "0": a primeira escrita a cria com 1. */
const LER_VERSIONADO = `
local partes = {ARGV[1]}
for i = 1, #KEYS do
  partes[#partes + 1] = redis.call('GET', KEYS[i]) or '0'
end
local chave = table.concat(partes, ':')
return {chave, redis.call('GET', chave)}
`;

const CONSUMIR = `
local c = redis.call('INCR', KEYS[1])
local t = redis.call('PTTL', KEYS[1])
if t < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  t = tonumber(ARGV[1])
end
return {c, t}
`;

const CONSULTAR = `
local c = tonumber(redis.call('GET', KEYS[1]) or '0')
local t = redis.call('PTTL', KEYS[1])
return {c, t}
`;

const DEVOLVER = `
local c = tonumber(redis.call('GET', KEYS[1]) or '0')
if c > 0 then redis.call('DECR', KEYS[1]) end
return 0
`;

/** As versões vivem bem mais que qualquer valor cacheado e se renovam a cada escrita. */
const TTL_DA_VERSAO_SEG = 30 * 24 * 3600;

function upstash(url: string, token: string): ClienteDeCache {
  const r = new Redis({
    url,
    token,
    automaticDeserialization: false,
    // O padrão são 5 tentativas com espera: com o Upstash fora, cada leitura
    // ficaria segundos parada antes de cair no banco.
    retry: { retries: 1, backoff: () => 50 },
  });
  return {
    async lerVersionado(base, chavesDeVersao) {
      const [chave, valor] = (await r.eval(LER_VERSIONADO, chavesDeVersao, [base])) as [string, string | null];
      return { chave, valor: valor ?? null };
    },
    async set(chave, valor, ttlSeg) {
      await r.set(chave, valor, { ex: ttlSeg });
    },
    async incr(chave) {
      await r.pipeline().incr(chave).expire(chave, TTL_DA_VERSAO_SEG).exec();
    },
    async consumirJanela(chave, janelaMs) {
      const [count, restanteMs] = (await r.eval(CONSUMIR, [chave], [String(janelaMs)])) as [number, number];
      return { count: Number(count), restanteMs: Number(restanteMs) };
    },
    async consultarJanela(chave) {
      const [count, restanteMs] = (await r.eval(CONSULTAR, [chave], [])) as [number, number];
      return { count: Number(count), restanteMs: Math.max(0, Number(restanteMs)) };
    },
    async devolverUnidade(chave) {
      await r.eval(DEVOLVER, [chave], []);
    },
    async del(chave) {
      await r.del(chave);
    },
  };
}

/**
 * Fake em memória com a mesma semântica — para os testes, que não podem discar
 * para fora (`tests/setup/no-outbound-http.ts`).
 */
export function clienteEmMemoria(): ClienteDeCache & { dados: Map<string, { v: string; expira: number }> } {
  const dados = new Map<string, { v: string; expira: number }>();
  const ler = (k: string) => {
    const e = dados.get(k);
    if (!e) return null;
    if (e.expira <= Date.now()) {
      dados.delete(k);
      return null;
    }
    return e;
  };
  return {
    dados,
    async lerVersionado(base, chavesDeVersao) {
      const chave = [base, ...chavesDeVersao.map((k) => ler(k)?.v ?? "0")].join(":");
      return { chave, valor: ler(chave)?.v ?? null };
    },
    async set(chave, valor, ttlSeg) {
      dados.set(chave, { v: valor, expira: Date.now() + ttlSeg * 1000 });
    },
    async incr(chave) {
      const atual = Number(ler(chave)?.v ?? "0");
      dados.set(chave, { v: String(atual + 1), expira: Date.now() + TTL_DA_VERSAO_SEG * 1000 });
    },
    async consumirJanela(chave, janelaMs) {
      const e = ler(chave);
      const expira = e?.expira ?? Date.now() + janelaMs;
      const count = Number(e?.v ?? "0") + 1;
      dados.set(chave, { v: String(count), expira });
      return { count, restanteMs: expira - Date.now() };
    },
    async consultarJanela(chave) {
      const e = ler(chave);
      return { count: Number(e?.v ?? "0"), restanteMs: e ? e.expira - Date.now() : 0 };
    },
    async devolverUnidade(chave) {
      const e = ler(chave);
      if (e && Number(e.v) > 0) dados.set(chave, { v: String(Number(e.v) - 1), expira: e.expira });
    },
    async del(chave) {
      dados.delete(chave);
    },
  };
}

let cliente: ClienteDeCache | null | undefined;

/**
 * `null` sem as duas variáveis do Upstash: o cache vira no-op e tudo lê do banco.
 * `KV_REST_API_*` são os nomes que a integração da Vercel cria.
 */
export function clienteDeCache(): ClienteDeCache | null {
  if (cliente !== undefined) return cliente;
  const url = (process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL)?.trim();
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN)?.trim();
  cliente = url && token ? upstash(url, token) : null;
  return cliente;
}

/** Só para testes: troca o cliente (fake em memória) ou desliga (`null`). */
export function definirClienteDeCache(c: ClienteDeCache | null | undefined): void {
  cliente = c;
}
