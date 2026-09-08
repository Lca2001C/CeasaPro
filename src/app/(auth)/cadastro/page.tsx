import type { Metadata } from "next";
import { TRIAL_DAYS } from "@/lib/billing/status";
import { CotacoesService } from "@/lib/services/cotacoes.service";
import { logger } from "@/lib/logger";
import { SignupForm } from "./_components/signup-form";

export const metadata: Metadata = {
  title: "Criar conta — CeasaPro",
  description: `Teste o CeasaPro por ${TRIAL_DAYS} dias, sem cartão de crédito.`,
};

// Renderizada por requisição para receber o nonce do CSP (ver `src/proxy.ts`).
export const dynamic = "force-dynamic";

export default async function CadastroPage() {
  /*
    A lista de centrais vem do servidor: é catálogo público (nenhum dado de
    empresa), e mandá-la pronta evita uma chamada extra no meio do cadastro.

    O `catch` não é cerimônia. Esta é a página de AQUISIÇÃO, e ela não dependia
    do banco até agora: sem a proteção, uma indisponibilidade momentâneo do
    Postgres passaria a derrubar a tela inteira, e o visitante iria embora por
    causa de um campo OPCIONAL. Com o catch, a lista vem vazia, os dois seletores
    ficam sem opção, e o cadastro por e-mail e senha continua funcionando — que é
    o que precisa acontecer.
  */
  const centrais = await CotacoesService.listarCentrais().catch((e) => {
    logger.error(
      { err: e instanceof Error ? e.message : String(e) },
      "Falha ao listar centrais na página de cadastro — seguindo sem a lista",
    );
    return [];
  });
  return <SignupForm trialDays={TRIAL_DAYS} centrais={centrais} />;
}
