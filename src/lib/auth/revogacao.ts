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
  const linhas = await prisma.$queryRaw<
    { ue: number; ativo: boolean; excluido: Date | null; te: number | null }[]
  >`
    SELECT u."sessionEpoch" AS ue,
           u.active         AS ativo,
           u."deletedAt"    AS excluido,
           t."sessionEpoch" AS te
    FROM users u
    LEFT JOIN tenants t ON t.id = u."tenantId"
    WHERE u.id = ${session.sub}
  `;

  const atual = linhas[0];
  if (!atual || !atual.ativo || atual.excluido) throw new UnauthorizedError();

  // Token sem os claims (emitido antes desta mudança) é tratado como epoch 0 —
  // o mesmo valor que as colunas recebem por default. Continua válido até
  // vencer, e o primeiro incremento o invalida.
  if ((session.sev ?? 0) !== atual.ue) throw new UnauthorizedError();
  if (atual.te !== null && (session.tev ?? 0) !== atual.te) throw new UnauthorizedError();
}
