"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { EXPENSE_TYPE_LABELS, toOptions } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export interface FiltrosAtuais {
  status: string;
  q: string;
  type: string;
  categoryId: string;
  dateField: string;
  from: string;
  to: string;
}

/**
 * Busca e filtros da lista de despesas.
 *
 * Com 6–12 meses de histórico a lista deixa de ser navegável, e o dono do box
 * procura sempre a mesma coisa: "a conta de luz", "as variáveis de agosto", "o
 * que paguei no mês passado". Tudo vira query string — o servidor filtra no
 * banco, e o link é compartilhável (é o mesmo endereço que os avisos usam).
 *
 * A busca fica sempre visível; o resto abre num painel, para a tela não virar um
 * formulário de sete campos no celular.
 */
export function DespesasFiltros({
  atuais,
  categorias,
}: {
  atuais: FiltrosAtuais;
  categorias: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(
    Boolean(atuais.type || atuais.categoryId || atuais.from || atuais.to),
  );
  const [f, setF] = useState<FiltrosAtuais>(atuais);

  function aplicar(patch: Partial<FiltrosAtuais> = {}) {
    const alvo = { ...f, ...patch };
    const params = new URLSearchParams();
    // `status` sempre presente para a aba continuar marcada; o resto só quando vale algo.
    params.set("status", alvo.status || "PENDENTE");
    if (alvo.q) params.set("q", alvo.q);
    if (alvo.type) params.set("type", alvo.type);
    if (alvo.categoryId) params.set("categoria", alvo.categoryId);
    if (alvo.from || alvo.to) {
      params.set("campo", alvo.dateField || "dueDate");
      if (alvo.from) params.set("de", alvo.from);
      if (alvo.to) params.set("ate", alvo.to);
    }
    params.set("pagina", "1");
    router.push(`/despesas?${params.toString()}`);
  }

  function limpar() {
    setF({ ...f, q: "", type: "", categoryId: "", from: "", to: "", dateField: "dueDate" });
    router.push(`/despesas?status=${f.status || "PENDENTE"}&pagina=1`);
  }

  const temFiltro = Boolean(f.q || f.type || f.categoryId || f.from || f.to);

  return (
    <div className="mb-4 flex flex-col gap-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por descrição..."
            value={f.q}
            onChange={(e) => setF({ ...f, q: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") aplicar();
            }}
            aria-label="Buscar despesa por descrição"
          />
        </div>
        <Button variant="outline" onClick={() => aplicar()} aria-label="Buscar">
          Buscar
        </Button>
        <Button
          variant={aberto ? "default" : "outline"}
          size="icon"
          onClick={() => setAberto((v) => !v)}
          aria-label="Mais filtros"
          aria-expanded={aberto}
        >
          <SlidersHorizontal className="size-4" />
        </Button>
      </div>

      {aberto && (
        <div className="grid grid-cols-2 gap-2 rounded-lg border p-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filtro-tipo">Tipo</Label>
            <Select
              id="filtro-tipo"
              value={f.type}
              onChange={(e) => setF({ ...f, type: e.target.value })}
            >
              <option value="">Todos</option>
              {toOptions(EXPENSE_TYPE_LABELS).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filtro-categoria">Categoria</Label>
            <Select
              id="filtro-categoria"
              value={f.categoryId}
              onChange={(e) => setF({ ...f, categoryId: e.target.value })}
            >
              <option value="">Todas</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="filtro-campo">Período por</Label>
            <Select
              id="filtro-campo"
              value={f.dateField || "dueDate"}
              onChange={(e) => setF({ ...f, dateField: e.target.value })}
            >
              <option value="dueDate">Vencimento</option>
              <option value="paidDate">Pagamento</option>
              <option value="createdAt">Cadastro</option>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filtro-de">De</Label>
            <Input
              id="filtro-de"
              type="date"
              value={f.from}
              onChange={(e) => setF({ ...f, from: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filtro-ate">Até</Label>
            <Input
              id="filtro-ate"
              type="date"
              value={f.to}
              onChange={(e) => setF({ ...f, to: e.target.value })}
            />
          </div>

          <div className="col-span-2 flex gap-2">
            {temFiltro && (
              <Button variant="ghost" className="flex-1" onClick={limpar}>
                <X className="size-4" /> Limpar
              </Button>
            )}
            <Button className="flex-1" onClick={() => aplicar()}>
              Aplicar filtros
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
