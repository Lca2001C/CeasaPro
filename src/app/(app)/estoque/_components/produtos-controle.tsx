"use client";

import { useRouter, usePathname } from "next/navigation";
import { ProdutoModal, type ProdutoEditavel } from "@/components/produtos/produto-modal";

/**
 * O modal de produto da tela de Estoque, dirigido pela URL.
 *
 * `?novo=1` abre o cadastro e `?editar=<id>` a edição. Por URL, e não por
 * estado, porque os atalhos de fora (botão "Novo produto" do Início, links
 * antigos de `/produtos/novo` e `/produtos/<id>`, o passo da cotação) precisam
 * chegar aqui já com o modal aberto.
 */
export function ProdutosControle({
  produtos,
  novo,
  editarId,
  fotosDisponiveis,
}: {
  produtos: ProdutoEditavel[];
  novo: boolean;
  editarId: string | null;
  fotosDisponiveis: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const produto = editarId ? (produtos.find((p) => p.id === editarId) ?? null) : null;
  const aberto = novo || Boolean(produto);

  function fechar() {
    // Tira só `novo`/`editar`; busca e filtro continuam.
    const params = new URLSearchParams(window.location.search);
    params.delete("novo");
    params.delete("editar");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <ProdutoModal
      open={aberto}
      onOpenChange={(v) => {
        if (!v) fechar();
      }}
      produto={produto}
      fotosDisponiveis={fotosDisponiveis}
      meusProdutos={produtos}
      onSalvo={() => router.refresh()}
    />
  );
}
