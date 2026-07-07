"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { criarTipoEmbalagem } from "@/actions/embalagens.actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function TipoEmbalagemForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim()) return toast.error("Informe o nome do tipo.");
    setSaving(true);
    const res = await criarTipoEmbalagem({ name: name.trim() });
    setSaving(false);
    if (res.ok) {
      toast.success("Tipo cadastrado.");
      setName("");
      router.refresh();
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <div className="flex gap-2">
      <Input
        placeholder="Ex.: Caixa de isopor"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <Button onClick={submit} disabled={saving}>
        {saving ? <Loader2 className="animate-spin" /> : <Plus />}
        Adicionar
      </Button>
    </div>
  );
}
