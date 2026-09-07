"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { concluirOnboarding } from "@/actions/config.actions";

/**
 * Convite para completar o cadastro, no Início.
 *
 * O cadastro passou a pedir só e-mail e senha. O que se ganha em quem termina o
 * cadastro, se perde em empresa sem nome e sem telefone — então alguém precisa
 * pedir o resto depois, e este cartão é esse alguém.
 *
 * É CARTÃO e não modal, pelo mesmo motivo do `ConviteTour`, de quem este
 * componente copia o desenho: interromper quem abriu o app para vender é o
 * oposto do que o produto se propõe. O pedido fica no caminho e espera.
 *
 * A dispensa vai para o SERVIDOR (`onboardingCompletedAt`), não para o
 * `localStorage` como no convite ao tour. A diferença importa: quem dispensa no
 * celular não deve reencontrar o cartão no computador, e "completar o cadastro"
 * é estado da empresa, não preferência do aparelho. Reaproveitar a coluna que já
 * existia — e que antes forçava o wizard — evita migration só para isso.
 */
export function CompletarCadastroCard({ faltando }: { faltando: string[] }) {
  const router = useRouter();
  const [dispensado, setDispensado] = useState(false);
  const [busy, setBusy] = useState(false);

  if (dispensado) return null;

  async function dispensar() {
    setBusy(true);
    // Otimista: o cartão sai na hora. Se a action falhar ele volta no próximo
    // carregamento, que é o desfecho certo — nada se perde.
    setDispensado(true);
    await concluirOnboarding();
    setBusy(false);
    router.refresh();
  }

  return (
    <Card className="border-primary/30 bg-accent/40">
      <CardContent className="flex flex-col gap-3 pt-4">
        <div className="flex gap-3">
          <ClipboardList className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="font-medium">Complete o cadastro da sua empresa</p>
            {faltando.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                Falta {listar(faltando)}. Leva um minuto, e é o que aparece no topo do
                sistema e no comprovante da mensalidade.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Cadastre seu primeiro fornecedor e seu primeiro produto para o sistema
                começar a servir para alguma coisa. Dá para pular.
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link href="/onboarding">Completar agora</Link>
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={dispensar}>
            Agora não
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Você pode completar quando quiser em Configurações.
        </p>
      </CardContent>
    </Card>
  );
}

/** "a" / "a e b" / "a, b e c" — sem vírgula antes do "e", como se escreve. */
function listar(itens: string[]): string {
  if (itens.length <= 1) return itens[0] ?? "";
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}
