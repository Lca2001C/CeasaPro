"use client";

import { useState, type ReactNode } from "react";
import { Container, PackageOpen } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type AbaCaixas = "caixas" | "embalagens";

/**
 * As duas abas de `/caixas-plasticas`: as caixas que voltam e as embalagens que
 * se vendem. Os dois "negócios de caixa" do box ficam lado a lado de propósito —
 * é na hora de escolher entre eles que o erro caro acontece (lançar caixa
 * retornável como venda avulsa some com ela do controle de devolução).
 *
 * A aba mora na URL (`?aba=embalagens`) para o link ser compartilhável e o
 * atalho antigo `/embalagens` cair direto nela. A troca usa `replaceState`, sem
 * ida ao servidor: o conteúdo das duas já veio renderizado.
 *
 * Quem tem só um dos módulos recebe só um conteúdo, e aí não há aba nenhuma —
 * uma lista de abas com uma aba só é ruído.
 */
export function AbasCaixasEmbalagens({
  abaInicial,
  caixas,
  embalagens,
}: {
  abaInicial: AbaCaixas;
  caixas?: ReactNode;
  embalagens?: ReactNode;
}) {
  const [aba, setAba] = useState<AbaCaixas>(abaInicial);

  if (!caixas || !embalagens) return <>{caixas ?? embalagens}</>;

  function trocar(valor: string) {
    const nova: AbaCaixas = valor === "embalagens" ? "embalagens" : "caixas";
    setAba(nova);
    const url = new URL(window.location.href);
    if (nova === "embalagens") url.searchParams.set("aba", "embalagens");
    else url.searchParams.delete("aba");
    // `nova=1` abre o formulário de venda; trocar de aba não deve reabri-lo.
    url.searchParams.delete("nova");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  return (
    <Tabs value={aba} onValueChange={trocar}>
      <TabsList>
        <TabsTrigger value="caixas">
          <Container aria-hidden className="size-4" />
          Caixas plásticas
        </TabsTrigger>
        <TabsTrigger value="embalagens" data-tour="aba-embalagens">
          <PackageOpen aria-hidden className="size-4" />
          Embalagens
        </TabsTrigger>
      </TabsList>
      <TabsContent value="caixas">{caixas}</TabsContent>
      <TabsContent value="embalagens">{embalagens}</TabsContent>
    </Tabs>
  );
}
