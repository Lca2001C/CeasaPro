"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Printer, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

const PRESETS = [
  { value: "hoje", label: "Hoje" },
  { value: "semana", label: "Últimos 7 dias" },
  { value: "mes", label: "Este mês" },
  { value: "mes_passado", label: "Mês passado" },
];

/** Por qual data do lançamento o período filtra (só relatório de despesas). */
const CAMPOS_DATA = [
  { value: "dueDate", label: "Por vencimento" },
  { value: "paidDate", label: "Por pagamento" },
  { value: "createdAt", label: "Por cadastro" },
];

/** "Todo o período": só no extrato de um cliente (ver `presetDoRelatorio`). */
const PRESET_TUDO = { value: "tudo", label: "Todo o período" };

export function ReportToolbar({
  kind,
  mostrarOpcoesDeDespesa = false,
  permiteEscolherData = false,
  clientes,
}: {
  kind: string;
  /** Habilita o agrupamento por categoria (relatórios de despesa). */
  mostrarOpcoesDeDespesa?: boolean;
  /** Habilita a escolha do critério de data (só o relatório de despesas). */
  permiteEscolherData?: boolean;
  /**
   * Clientes do filtro (só o relatório de vendas). Com um escolhido, o
   * relatório vira o extrato dele, com os itens de cada venda.
   */
  clientes?: { chave: string; nome: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const cliente = params.get("cliente") ?? "";
  // Sem cliente, "tudo" não vale (o servidor também cai em "mes").
  const presetDaUrl = params.get("preset") ?? "mes";
  const preset = presetDaUrl === "tudo" && !cliente ? "mes" : presetDaUrl;
  const presets = cliente ? [...PRESETS, PRESET_TUDO] : PRESETS;
  const campo = params.get("campo") ?? "dueDate";
  const agrupar = params.get("agrupar") ?? "";

  /** Reescreve a URL preservando as outras opções — trocar o período não pode
      desfazer o agrupamento que a pessoa acabou de escolher. */
  function atualizar(patch: Record<string, string>) {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    router.push(`${pathname}?${q.toString()}`);
  }

  const exportar = (formato: "excel" | "pdf") => {
    const q = new URLSearchParams({ preset, format: formato });
    // Período personalizado (vem da URL): sem repassar as datas, o arquivo
    // saía com "Este mês" enquanto a tela mostrava outro período.
    if (preset === "personalizado") {
      const from = params.get("from");
      const to = params.get("to");
      if (from) q.set("from", from);
      if (to) q.set("to", to);
    }
    if (permiteEscolherData && campo !== "dueDate") q.set("campo", campo);
    if (mostrarOpcoesDeDespesa && agrupar) q.set("agrupar", agrupar);
    if (clientes && cliente) q.set("cliente", cliente);
    return `/api/reports/${kind}/export?${q.toString()}`;
  };

  return (
    <div className="no-print flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <div className="w-full sm:w-44">
          <Select
            value={preset}
            onChange={(e) => atualizar({ preset: e.target.value })}
            aria-label="Período"
          >
            {presets.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>

        {clientes && (
          <div className="w-full sm:w-56">
            <Select
              value={cliente}
              // Tirar o cliente com "Todo o período" escolhido volta ao mês:
              // o histórico inteiro só existe no extrato de um cliente.
              onChange={(e) =>
                atualizar({
                  cliente: e.target.value,
                  ...(!e.target.value && preset === "tudo" ? { preset: "mes" } : {}),
                })
              }
              aria-label="Cliente"
            >
              <option value="">Todos os clientes</option>
              {clientes.map((c) => (
                <option key={c.chave} value={c.chave}>
                  {c.nome}
                </option>
              ))}
            </Select>
          </div>
        )}

        {permiteEscolherData && (
          <div className="w-full sm:w-44">
            <Select
              value={campo}
              onChange={(e) => atualizar({ campo: e.target.value })}
              aria-label="Critério de data"
            >
              {CAMPOS_DATA.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
        )}

        {mostrarOpcoesDeDespesa && (
          <div className="w-full sm:w-52">
            <Select
              value={agrupar}
              onChange={(e) => atualizar({ agrupar: e.target.value })}
              aria-label="Agrupamento"
            >
              <option value="">Sem agrupamento</option>
              <option value="categoria">Agrupar por categoria</option>
            </Select>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => window.print()}>
          <Printer /> Imprimir / PDF
        </Button>
        <Button asChild variant="info">
          <a href={exportar("excel")}>
            <FileDown /> Baixar Excel
          </a>
        </Button>
        <Button asChild variant="info">
          <a href={exportar("pdf")}>
            <FileDown /> Baixar PDF
          </a>
        </Button>
      </div>
    </div>
  );
}
