import { requireTenant } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/plan/modules";
import { PageHeader } from "@/components/data/page-header";
import { AbasCaixasEmbalagens, type AbaCaixas } from "./_components/abas";
import { ConteudoCaixas } from "./_components/conteudo-caixas";
import { ConteudoEmbalagens } from "./_components/conteudo-embalagens";

export const dynamic = "force-dynamic";

/**
 * Caixas e embalagens — uma tela, duas abas.
 *
 * Os dois MÓDULOS continuam separados no plano (`caixas` e `embalagens`): quem
 * contratou só um vê só a aba dele, e a consulta da outra nem roda. O layout
 * deste segmento deixa entrar quem tem qualquer um dos dois; as subtelas
 * (`/caixas-plasticas/novo`) têm o gate próprio do módulo dono.
 */
export default async function CaixasEEmbalagensPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string; nova?: string }>;
}) {
  const { aba, nova } = await searchParams;
  const { session, tenantId } = await requireTenant();
  const temCaixas = isModuleEnabled(session.modules, "caixas");
  const temEmbalagens = isModuleEnabled(session.modules, "embalagens");

  const abaInicial: AbaCaixas =
    !temCaixas || (temEmbalagens && aba === "embalagens") ? "embalagens" : "caixas";

  const cabecalho =
    temCaixas && temEmbalagens
      ? {
          titulo: "Caixas e embalagens",
          descricao:
            "As caixas plásticas que saem com a mercadoria e voltam, e as embalagens vendidas à parte.",
        }
      : temCaixas
        ? {
            titulo: "Caixas plásticas",
            descricao:
              "As caixas que saem com a mercadoria e voltam. Entrada, saída, devolução, higienização e perdas.",
          }
        : {
            titulo: "Venda de embalagens",
            descricao: "Papelão, sacaria e caixas vendidas à parte — o cliente leva e não devolve.",
          };

  return (
    <div>
      <PageHeader title={cabecalho.titulo} description={cabecalho.descricao} />
      <AbasCaixasEmbalagens
        key={abaInicial}
        abaInicial={abaInicial}
        caixas={temCaixas ? <ConteudoCaixas tenantId={tenantId} /> : undefined}
        embalagens={
          temEmbalagens ? (
            <ConteudoEmbalagens
              tenantId={tenantId}
              abrirNovaVenda={nova === "1"}
              temCaixas={temCaixas}
            />
          ) : undefined
        }
      />
    </div>
  );
}
