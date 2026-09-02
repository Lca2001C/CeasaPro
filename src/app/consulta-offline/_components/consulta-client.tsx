"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CloudOff, RefreshCw, WifiOff } from "lucide-react";
import type { PwaSnapshot } from "@/app/api/pwa/snapshot/route";
import { carregarSnapshot, idadeEmMinutos } from "@/lib/pwa/offline-store";
import { useOnline } from "@/lib/pwa/use-online";
import { valorExibivel } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Consulta dos dados salvos, para usar sem rede.
 *
 * Precisa ser componente de cliente e ler do IndexedDB porque, offline, não há
 * servidor para renderizar nada — inclusive não há sessão para validar. Por isso o
 * conteúdo é sempre e apenas o que já estava no aparelho.
 *
 * A regra que a tela toda respeita: **todo número vem acompanhado da hora em que
 * foi buscado**. Sem isso o cliente olha um estoque de ontem achando que é o de
 * agora e vende o que não tem.
 */

// `valorExibivel` pelo mesmo motivo do `StatCard`: o `toLocaleString` separa
// "R$" do número com NBSP, que proíbe quebra, então valor comprido estoura a
// caixa; e o negativo com hífen deixa o sinal órfão numa linha só dele.
const brl = (v: number) =>
  valorExibivel(v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

const qtd = (v: number) =>
  v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

function descreverIdade(minutos: number): string {
  if (minutos < 1) return "agora mesmo";
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.floor(horas / 24);
  return `há ${dias} ${dias === 1 ? "dia" : "dias"}`;
}

export function ConsultaOfflineClient() {
  const online = useOnline();
  const [snapshot, setSnapshot] = useState<PwaSnapshot | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    carregarSnapshot()
      .then((s) => {
        if (!vivo) return;
        setSnapshot(s);
        setCarregando(false);
      })
      .catch(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, []);

  if (carregando) {
    return <p className="p-6 text-center text-sm text-muted-foreground">Carregando…</p>;
  }

  // Sem snapshot é estado NORMAL, não erro: primeiro acesso, ou o navegador
  // descartou os dados (o Safari limpa sites pouco usados). O texto explica em vez
  // de mostrar tela vazia.
  if (!snapshot) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <CloudOff className="size-10 text-muted-foreground" />
        <div className="flex flex-col gap-1">
          <p className="font-medium">Nenhum dado salvo neste aparelho</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            Os dados para consulta offline são guardados quando você abre o Início
            com internet. Conecte-se uma vez e eles ficam disponíveis aqui.
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard">Tentar abrir o Início</Link>
        </Button>
      </div>
    );
  }

  const minutos = idadeEmMinutos(snapshot);
  const antigo = minutos !== null && minutos >= 60;

  return (
    <div className="mx-auto w-full max-w-3xl p-4 pb-16">
      {/* Cabeçalho: o quê e de quando. Nunca um sem o outro. */}
      <div
        className={`mb-4 flex items-start gap-2 rounded-md border p-3 text-sm ${
          antigo ? "border-warning/40 bg-warning/5 text-warning" : "bg-muted"
        }`}
      >
        {online ? (
          <RefreshCw className="mt-0.5 size-4 shrink-0" />
        ) : (
          <WifiOff className="mt-0.5 size-4 shrink-0" />
        )}
        <div>
          <p className="font-medium">
            Dados de{" "}
            {new Date(snapshot.cachedAt).toLocaleString("pt-BR", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
            {minutos !== null && ` — ${descreverIdade(minutos)}`}
          </p>
          <p className={antigo ? "" : "text-muted-foreground"}>
            {online
              ? "Você está online: abra o Início para ver os números atuais."
              : "Sem conexão. Estes são os últimos dados salvos no aparelho."}
          </p>
        </div>
      </div>

      {online && (
        <Button asChild className="mb-4 w-full">
          <Link href="/dashboard">Ver dados atualizados</Link>
        </Button>
      )}

      {/* Resumo */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        {[
          ["Vendi hoje", snapshot.resumo.hojeVendi],
          ["Tenho para receber", snapshot.resumo.aReceber],
          ["Valor em estoque", snapshot.resumo.estoqueValor],
          ["Contas a pagar", snapshot.resumo.contasPagar],
        ].map(([label, valor]) => (
          <Card key={label as string}>
            <CardContent className="py-3">
              <p className="text-xs text-muted-foreground">{label as string}</p>
              {/*
                `overflow-wrap:anywhere` fecha a última brecha: com o espaço já
                quebrável, um valor comprido desce o número para a linha de
                baixo em vez de vazar pela borda do cartão.
              */}
              <p className="text-lg font-semibold tabular-nums [overflow-wrap:anywhere]">
                {brl(valor as number)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Avisos */}
      {snapshot.avisos.length > 0 && (
        <>
          <h2 className="mb-2 text-base font-semibold">Precisa de atenção</h2>
          <Card className="mb-4">
            <CardContent className="flex flex-col gap-2 py-3 text-sm">
              {snapshot.avisos.map((a) => (
                <div key={a.tipo} className="flex justify-between gap-3">
                  {/* `min-w-0`: sem ele o rótulo não encolhe abaixo da palavra
                      mais longa e empurra o valor para fora do cartão. */}
                  <span className="min-w-0">{a.label}</span>
                  <span className="shrink-0 font-medium tabular-nums">{brl(a.total)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}

      {/* Fiado */}
      <h2 className="mb-1 text-base font-semibold">Quem me deve</h2>
      <p className="mb-2 text-sm text-muted-foreground">
        Total em aberto:{" "}
        <strong className="text-foreground">{brl(snapshot.totais.fiadoEmAberto)}</strong>
        {snapshot.totais.caixasComClientes > 0 &&
          ` · ${snapshot.totais.caixasComClientes} caixa(s) com clientes`}
      </p>
      {snapshot.fiado.length === 0 ? (
        <p className="mb-4 text-sm text-muted-foreground">Ninguém devendo. Bom sinal.</p>
      ) : (
        <Card className="mb-4">
          <CardContent className="flex flex-col divide-y py-0 text-sm">
            {snapshot.fiado.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.cliente}</p>
                  {c.caixasComCliente > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {c.caixasComCliente} caixa(s) com ele
                    </p>
                  )}
                </div>
                <span className="shrink-0 font-semibold tabular-nums">{brl(c.saldo)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Estoque */}
      <h2 className="mb-2 text-base font-semibold">O que tenho em estoque</h2>
      {snapshot.estoque.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum produto com saldo.</p>
      ) : (
        <Card>
          <CardContent className="flex flex-col divide-y py-0 text-sm">
            {snapshot.estoque.map((p) => (
              <div key={p.productId} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0 truncate">{p.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {qtd(p.quantity)} {p.saleUnit.toLowerCase()}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Esta tela é somente consulta. Para registrar venda, compra ou pagamento é
        preciso estar conectado.
      </p>
    </div>
  );
}
