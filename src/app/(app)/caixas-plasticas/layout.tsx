import { requirePagina } from "@/lib/auth/pagina";

/**
 * Gate de módulo da tela Caixas e embalagens.
 *
 * Esta tela serve a DOIS módulos (`TELAS_COMPARTILHADAS` em `lib/plan/modules`):
 * entra quem tiver qualquer um deles, e a página mostra só a aba de cada um. As
 * chaves continuam separadas no plano.
 *
 * Como o layout cobre a subárvore, isto sozinho afrouxaria as subtelas — por
 * isso cada uma (`novo/`) tem o próprio layout exigindo o módulo dono, e
 * `paginas-module-gate.test.ts` recusa uma subtela nova sem ele.
 *
 * Não sobe para `(app)/layout.tsx`: aquele é o segmento COMUM, e o Next não o
 * reexecuta numa navegação que não cruze o segmento dele — o gate seria
 * avaliado uma vez na entrada do grupo e nunca mais.
 */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requirePagina({ algumModulo: ["caixas", "embalagens"] });
  return children;
}
