import "server-only";
import { prisma } from "@/lib/db/prisma";
import { UnauthorizedError } from "@/lib/http/app-error";
import type { Session } from "./session";

/**
 * A sessão ainda vale AGORA — não só quando o token foi emitido?
 *
 * O problema. A leitura da sessão é totalmente stateless: `getSession()` só
 * verifica o JWT, e nenhum wrapper revalidava contra o banco. Todos os pontos de
 * revogação mexiam apenas em `refresh_tokens` — desativar usuário, resetar
 * senha, excluir usuário, excluir ou bloquear empresa, estorno/chargeback,
 * troca de senha. O access token continuava autorizando ESCRITA por até 15
 * minutos.
 *
 * O caso concreto: o super-admin exclui um funcionário demitido às 10:00; até
 * as 10:15 o JWT dele ainda registra venda, recebe fiado e exporta relatório. E
 * a tela de redefinição de senha promete o contrário, com todas as letras:
 * "todos os dispositivos conectados serão desconectados".
 *
 * A solução. Dois contadores — `users.sessionEpoch` e `tenants.sessionEpoch` —
 * viajam no token como `sev`/`tev`. `revokeAllForUser` e `revokeAllForTenant`
 * os incrementam, e como TODOS os pontos de revogação já chamavam uma dessas
 * duas funções, nenhum call site precisou lembrar de nada.
 *
 * Onde é conferido: nos quatro wrappers (toda escrita e toda API) e nos dois
 * layouts de grupo (a entrada em qualquer área). NÃO no proxy, que roda no Edge
 * sem banco, e NÃO em `getSession()`, que taxaria todo render de RSC.
 *
 * Janela residual, dita em voz alta: navegação client-side entre duas telas do
 * mesmo grupo, sem nenhuma chamada de API e sem escrita, continua limitada ao
 * TTL do token. Nesse intervalo a pessoa só vê o que já estava renderizado.
 *
 * Custo: uma consulta indexada por requisição que escreve. Uma só — daí o SQL
 * cru em vez de `findUnique` com `select` de relação, que o Prisma emitiria
 * como duas consultas sem o preview `relationJoins`.
 */
export async function assertSessaoValida(session: Session): Promise<void> {
  if (!(await sessaoAindaValida(session))) throw new UnauthorizedError();
}

/** O que `sessaoAindaValida` lê do banco: o usuário e o epoch da empresa dele. */
export type EstadoDaSessaoNoBanco = {
  ue: number;
  ativo: boolean;
  excluido: Date | null;
  te: number | null;
};

/**
 * A decisão, sem banco: o token (`sev`/`tev`) ainda confere com o estado atual?
 *
 * Separada para ser testada sozinha e para que os dois consumidores — os
 * wrappers, que LANÇAM (o erro vira 401 no envelope), e os layouts de grupo,
 * que REDIRECIONAM — usem exatamente a mesma regra.
 */
export function sessaoConfere(
  session: Pick<Session, "sev" | "tev">,
  atual: EstadoDaSessaoNoBanco | undefined,
): boolean {
  if (!atual || !atual.ativo || atual.excluido) return false;
  // Token sem os claims (emitido antes desta mudança) é tratado como epoch 0 —
  // o mesmo valor que as colunas recebem por default. Continua válido até
  // vencer, e o primeiro incremento o invalida.
  if ((session.sev ?? 0) !== atual.ue) return false;
  if (atual.te !== null && (session.tev ?? 0) !== atual.te) return false;
  return true;
}

/**
 * Versão que NÃO lança — para os layouts `(app)` e `(admin)`.
 *
 * Com `assertSessaoValida` no layout, a sessão revogada virava exceção, e o
 * `error.tsx` de um grupo não cobre o PRÓPRIO layout: caía no `global-error`,
 * cujo "Tentar de novo" falha igual. Ir ao `/login` também não saía do lugar,
 * porque o proxy vê o access cookie ainda válido e manda de volta à home. Por
 * até 15 minutos (o TTL do access) a pessoa ficava sem saída.
 *
 * Com o booleano, o layout redireciona para `rotaDeSessaoRevogada` (em
 * `renovacao.ts`), que tenta renovar e, não dando, APAGA os cookies — é o
 * apagar que quebra o laço com o proxy.
 *
 * Falha de BANCO continua lançando: aí o "Tentar de novo" é a resposta certa.
 */
export async function sessaoAindaValida(session: Session): Promise<boolean> {
  const linhas = await prisma.$queryRaw<EstadoDaSessaoNoBanco[]>`
    SELECT u."sessionEpoch" AS ue,
           u.active         AS ativo,
           u."deletedAt"    AS excluido,
           t."sessionEpoch" AS te
    FROM users u
    LEFT JOIN tenants t ON t.id = u."tenantId"
    WHERE u.id = ${session.sub}
  `;
  return sessaoConfere(session, linhas[0]);
}
