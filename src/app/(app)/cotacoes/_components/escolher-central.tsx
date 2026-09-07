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
          {centrais.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name} — {c.city}/{c.uf}
            </option>
          ))}
        </Select>
        <span className="text-xs text-muted-foreground">
          É a central de onde vêm os preços que você vê em Cotações.
        </span>
      </div>
      <Button type="button" onClick={salvar} disabled={saving || valor === (atual ?? "")}>
        {saving && <Loader2 className="animate-spin" />}
        Salvar central
      </Button>
    </div>
  );
}
