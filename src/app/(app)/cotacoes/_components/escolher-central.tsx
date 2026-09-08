"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { escolherCentral } from "@/actions/cotacoes.actions";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

interface Central {
  code: string;
  name: string;
  city: string;
  uf: string;
  /** Tem busca automática de boletim? Ver `CotacoesService.listarCentrais`. */
  automatica: boolean;
}

/**
 * Escolha da central do CEASA.
 *
 * Aparece em dois lugares: no estado vazio de `/cotacoes` (onde é a única coisa
 * a fazer) e em Configurações (onde é permanente, para trocar depois). NÃO
 * aparece no cadastro: o cadastro é o caminho de aquisição e não ganha um passo
 * por causa de um módulo opcional.
 */
export function EscolherCentral({
  centrais,
  atual,
  autoFoco = false,
}: {
  centrais: Central[];
  atual: string | null;
  autoFoco?: boolean;
}) {
  const router = useRouter();
  const [valor, setValor] = useState(atual ?? "");
  const [saving, setSaving] = useState(false);

  const automaticas = centrais.filter((c) => c.automatica);
  const manuais = centrais.filter((c) => !c.automatica);
  const escolhida = centrais.find((c) => c.code === valor) ?? null;

  async function salvar() {
    setSaving(true);
    const res = await escolherCentral({ centralCode: valor || null });
    setSaving(false);
    if (res.ok) {
      toast.success("Central atualizada");
      router.refresh();
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ceasaCentral">Sua central do CEASA</Label>
        <Select
          id="ceasaCentral"
          value={valor}
          autoFocus={autoFoco}
          onChange={(e) => setValor(e.target.value)}
        >
          <option value="">Não informada</option>
          {/*
            Separadas por grupo, e não numa lista só: das 65 centrais, 8 têm
            busca automática e 57 dependem de alguém enviar o boletim. Numa lista
            única, quem é de Recife escolheria a sua e ficaria esperando um preço
            que ninguém vai buscar — e só descobriria isso depois.
          */}
          {automaticas.length > 0 && (
            <optgroup label="Com preços automáticos">
              {automaticas.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} — {c.city}/{c.uf}
                </option>
              ))}
            </optgroup>
          )}
          {manuais.length > 0 && (
            <optgroup label="Sem busca automática ainda">
              {manuais.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} — {c.city}/{c.uf}
                </option>
              ))}
            </optgroup>
          )}
        </Select>
        {escolhida && !escolhida.automatica ? (
          <span className="text-xs text-warning">
            Ainda não buscamos o boletim desta central automaticamente. Os preços só
            aparecem se forem enviados manualmente — estamos trabalhando para incluí-la.
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            É a central de onde vêm os preços que você vê em Cotações.
          </span>
        )}
      </div>
      <Button type="button" onClick={salvar} disabled={saving || valor === (atual ?? "")}>
        {saving && <Loader2 className="animate-spin" />}
        Salvar central
      </Button>
    </div>
  );
}
