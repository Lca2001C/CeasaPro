"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Database, ImageIcon, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { buscarFotosDoBanco, enviarFotoProduto } from "@/actions/produtos.actions";
import { chamarAction } from "@/lib/http/chamar-action";
import { comprimirFoto } from "@/lib/imagem/comprimir";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface FotoEscolhida {
  imageKey: string;
  url: string | null;
}

/**
 * "Imagem do produto": Câmera, Galeria ou Banco.
 *
 * - **Câmera** e **Galeria** são `<input type="file">`. O `capture="environment"`
 *   abre a câmera traseira nativa do celular — não depende de `getUserMedia`
 *   nem do `Permissions-Policy: camera=()` do site, que continua fechado.
 * - A foto é comprimida no aparelho e enviada na hora; o formulário guarda só a
 *   chave devolvida. Enquanto envia, `onEnviando(true)` segura o Salvar.
 * - **Banco** busca as fotos da plataforma pelo nome digitado no produto.
 *
 * `disponivel = false` quando o servidor não tem armazenamento configurado: os
 * botões aparecem desabilitados com o aviso, e o cadastro segue sem foto.
 */
export function ImagemProduto({
  valor,
  onChange,
  onEnviando,
  nomeDoProduto,
  disponivel,
}: {
  valor: FotoEscolhida | null;
  onChange: (foto: FotoEscolhida | null) => void;
  onEnviando: (enviando: boolean) => void;
  nomeDoProduto: string;
  disponivel: boolean;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galeriaRef = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [previa, setPrevia] = useState<string | null>(null);
  const [bancoAberto, setBancoAberto] = useState(false);

  async function aoEscolherArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    // Limpa o input: escolher a MESMA foto de novo precisa disparar o change.
    e.target.value = "";
    if (!arquivo) return;
    setEnviando(true);
    onEnviando(true);
    try {
      const { base64, previa: dataUrl } = await comprimirFoto(arquivo);
      setPrevia(dataUrl);
      const res = await chamarAction(() => enviarFotoProduto({ base64 }));
      if (res.ok) {
        onChange(res.data);
        setBancoAberto(false);
      } else {
        setPrevia(null);
        toast.error(res.error.message);
      }
    } catch (err) {
      setPrevia(null);
      toast.error(err instanceof Error ? err.message : "Não foi possível usar esta foto.");
    } finally {
      setEnviando(false);
      onEnviando(false);
    }
  }

  const mostrada = previa ?? valor?.url ?? null;

  return (
    <div className="flex flex-col gap-2">
      {(mostrada || enviando) && (
        <div className="relative mx-auto size-28 overflow-hidden rounded-lg border bg-muted">
          {mostrada ? (
            // eslint-disable-next-line @next/next/no-img-element -- foto do bucket público; `next/image` gastaria a cota de otimização da Vercel por uma miniatura
            <img src={mostrada} alt="Foto do produto" className="size-full object-cover" />
          ) : null}
          {enviando ? (
            <span className="absolute inset-0 flex items-center justify-center bg-background/60">
              <Loader2 className="size-6 animate-spin" />
            </span>
          ) : (
            <button
              type="button"
              onClick={() => {
                setPrevia(null);
                onChange(null);
              }}
              className="absolute right-1 top-1 rounded-full bg-background/90 p-1 shadow"
              aria-label="Remover foto"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-11"
          disabled={!disponivel || enviando}
          onClick={() => cameraRef.current?.click()}
        >
          <Camera /> Câmera
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11"
          disabled={!disponivel || enviando}
          onClick={() => galeriaRef.current?.click()}
        >
          <ImageIcon /> Galeria
        </Button>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "h-11",
            bancoAberto && "border-primary bg-primary/10 text-primary hover:bg-primary/15",
          )}
          disabled={!disponivel || enviando}
          onClick={() => setBancoAberto((v) => !v)}
          aria-expanded={bancoAberto}
        >
          <Database /> Banco
        </Button>
      </div>

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={aoEscolherArquivo}
        aria-label="Tirar foto com a câmera"
        data-testid="foto-camera"
      />
      <input
        ref={galeriaRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={aoEscolherArquivo}
        aria-label="Escolher foto da galeria"
        data-testid="foto-galeria"
      />

      {!disponivel && (
        <p className="text-xs text-muted-foreground">
          O envio de fotos ainda não está disponível. Você pode salvar o produto sem foto.
        </p>
      )}

      {bancoAberto && disponivel && (
        <BancoDeFotos
          busca={nomeDoProduto}
          selecionada={valor?.imageKey ?? null}
          onEscolher={(foto) => {
            setPrevia(null);
            onChange(foto);
            setBancoAberto(false);
          }}
        />
      )}
    </div>
  );
}

function BancoDeFotos({
  busca,
  selecionada,
  onEscolher,
}: {
  busca: string;
  selecionada: string | null;
  onEscolher: (foto: FotoEscolhida) => void;
}) {
  const [q, setQ] = useState(busca);
  const [fotos, setFotos] = useState<
    { id: string; nome: string; imageKey: string; url: string | null }[] | null
  >(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let cancelado = false;
    const t = setTimeout(async () => {
      setCarregando(true);
      const res = await chamarAction(() => buscarFotosDoBanco({ q: q.trim() || undefined }));
      if (cancelado) return;
      setCarregando(false);
      if (res.ok) setFotos(res.data);
      else toast.error(res.error.message);
    }, 300);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Buscar no banco de fotos..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Buscar no banco de fotos"
        />
      </div>
      {carregando && fotos === null ? (
        <div className="flex justify-center py-6">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : fotos && fotos.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          Nenhuma foto com esse nome. Tente outra palavra ou tire uma foto.
        </p>
      ) : (
        <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
          {fotos?.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onEscolher({ imageKey: f.imageKey, url: f.url })}
              className={cn(
                "flex flex-col items-center gap-1 rounded-md border p-1 text-xs hover:bg-muted",
                selecionada === f.imageKey && "border-primary ring-2 ring-primary/40",
              )}
              aria-label={`Usar a foto ${f.nome}`}
            >
              {f.url ? (
                // eslint-disable-next-line @next/next/no-img-element -- ver nota em ImagemProduto
                <img
                  src={f.url}
                  alt=""
                  className="aspect-square w-full rounded object-cover"
                  loading="lazy"
                />
              ) : (
                <span className="aspect-square w-full rounded bg-muted" />
              )}
              <span className="line-clamp-1 w-full text-center">{f.nome}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
