"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImageIcon, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { criarFotoDoBanco } from "@/actions/admin-imagens.actions";
import { chamarAction } from "@/lib/http/chamar-action";
import { comprimirFoto, copiarFoto } from "@/lib/imagem/comprimir";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Envio de foto para o banco: nome + arquivo, comprimido no navegador. */
export function NovaFoto() {
  const router = useRouter();
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [nome, setNome] = useState("");
  const [foto, setFoto] = useState<{ base64: string; previa: string } | null>(null);
  const [preparando, setPreparando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const bruto = e.target.files?.[0];
    if (!bruto) return;
    setPreparando(true);
    try {
      const arquivo = await copiarFoto(bruto);
      e.target.value = "";
      setFoto(await comprimirFoto(arquivo));
      // Sugestão de nome a partir do arquivo ("tomate-italiano.jpg") — só se o
      // campo AINDA estiver vazio. A compressão leva um instante, e quem
      // digitou o nome enquanto ela rodava tinha o texto trocado pelo do
      // arquivo: o `nome` desta função é o de quando a foto foi escolhida.
      const sugestao = arquivo.name
        .replace(/\.[^.]+$/, "")
        .replace(/[-_]+/g, " ")
        .replace(/^\w/, (c) => c.toUpperCase());
      setNome((atual) => atual || sugestao);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível usar esta foto.");
    } finally {
      e.target.value = "";
      setPreparando(false);
    }
  }

  async function salvar() {
    if (!foto) return toast.error("Escolha a foto.");
    if (!nome.trim()) return toast.error("Informe o nome.");
    setSalvando(true);
    const res = await chamarAction(() =>
      criarFotoDoBanco({ nome: nome.trim(), base64: foto.base64 }),
    );
    setSalvando(false);
    if (res.ok) {
      toast.success("Foto adicionada ao banco");
      setNome("");
      setFoto(null);
      router.refresh();
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-3 sm:flex-row sm:items-end">
      <button
        type="button"
        onClick={() => arquivoRef.current?.click()}
        className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed bg-muted"
        aria-label="Escolher foto"
      >
        {preparando ? (
          <Loader2 className="size-5 animate-spin" />
        ) : foto ? (
          // eslint-disable-next-line @next/next/no-img-element -- prévia local (data:)
          <img src={foto.previa} alt="" className="size-full object-cover" />
        ) : (
          <ImageIcon className="size-6 text-muted-foreground" />
        )}
      </button>
      <input ref={arquivoRef} type="file" accept="image/*" className="hidden" onChange={escolher} />
      <div className="flex flex-1 flex-col gap-1.5">
        <Label htmlFor="foto-nome">Nome do produto</Label>
        <Input
          id="foto-nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex.: Tomate italiano"
        />
      </div>
      <Button type="button" onClick={salvar} disabled={salvando || preparando || !foto}>
        {salvando ? <Loader2 className="animate-spin" /> : <Plus />}
        Adicionar ao banco
      </Button>
    </Card>
  );
}
