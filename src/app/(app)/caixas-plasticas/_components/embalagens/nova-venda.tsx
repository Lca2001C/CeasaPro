"use client";

import { useState } from "react";
import { CartaoDeAcao } from "@/components/ui/cartao-de-acao";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { VendaEmbalagemForm } from "./venda-embalagem-form";

/**
 * "Nova venda de embalagem": o formulário abre por cima da aba — folha que
 * sobe de baixo no celular, janela no desktop — e, ao salvar, a venda aparece
 * na lista sem trocar de tela.
 *
 * `abrirAoCarregar` vem de `?nova=1`, o destino do endereço antigo
 * `/embalagens/nova`. Ao fechar, o parâmetro sai da URL: senão um recarregar
 * reabriria a venda que já foi registrada.
 */
export function NovaVendaEmbalagem({
  tipos,
  abrirAoCarregar,
}: {
  tipos: { id: string; name: string }[];
  abrirAoCarregar: boolean;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(abrirAoCarregar);

  function mudar(valor: boolean) {
    setAberto(valor);
    if (!valor) {
      const url = new URL(window.location.href);
      if (url.searchParams.has("nova")) {
        url.searchParams.delete("nova");
        window.history.replaceState(null, "", `${url.pathname}${url.search}`);
      }
    }
  }

  return (
    <>
      <CartaoDeAcao
        onClick={() => mudar(true)}
        className="mb-0"
        titulo="Nova Venda de Embalagem"
        descricao="Papelão, sacaria e afins — o cliente leva e não devolve"
      />

      <Dialog open={aberto} onOpenChange={mudar}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova venda de embalagem</DialogTitle>
            <DialogDescription>
              Papelão, sacaria e afins — o cliente leva e não devolve.
            </DialogDescription>
          </DialogHeader>
          {tipos.length === 0 ? (
            <EstadoVazio
              titulo="Cadastre um tipo de embalagem primeiro"
              descricao="Feche esta janela e adicione o tipo em Tipos e estoque (ex.: Caixa de papelão, Sacaria)."
            />
          ) : (
            <VendaEmbalagemForm
              tipos={tipos}
              onCancelar={() => mudar(false)}
              onSalvo={() => {
                mudar(false);
                router.refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
