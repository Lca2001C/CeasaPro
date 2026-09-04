"use client";

import { useState, useSyncExternalStore } from "react";
import { Compass } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BotaoTour } from "./botao-tour";
import {
  assinarTour,
  convidadoNoServidor,
  jaFoiConvidado,
  lerPosicao,
  marcarConvidado,
  semMudanca,
  tourParado,
} from "@/lib/tour/estado";

/**
 * Convite ao tour, no Início.
 *
 * Sem ele o tour existiria e ninguém saberia: quem acaba de entrar não vai
 * procurar Tutorial no topo antes de ter um problema. Então o convite tem de
 * ir à pessoa — uma vez, na tela que todo mundo abre primeiro.
 *
 * É um CARTÃO, e não um painel que abre sozinho, por duas razões. A primeira
 * tela depois do login já pode receber o convite de instalar o app, que é
 * modal; dois modais em sequência viram um obstáculo, e o segundo é dispensado
 * sem leitura. A segunda é que interromper alguém que abriu o app para vender
 * é o oposto do que este produto se propõe — o convite fica visível, no
 * caminho, e espera.
 *
 * Aparece uma vez só: entrar no tour ou dispensar o convite grava a resposta
 * (ver `marcarConvidado`). Depois disso o caminho é o botão Tutorial no topo.
 */
export function ConviteTour() {
  const jaConvidado = useSyncExternalStore(
    semMudanca,
    jaFoiConvidado,
    convidadoNoServidor,
  );
  const posicao = useSyncExternalStore(assinarTour, lerPosicao, tourParado);
  const [dispensado, setDispensado] = useState(false);

  // Com o tour em andamento o convite sai da tela: ele já foi aceito, e o
  // primeiro balão fala por ele.
  if (jaConvidado || dispensado || posicao !== null) return null;

  return (
    <Card className="border-primary/30 bg-accent/40">
      <CardContent className="flex flex-col gap-3 pt-4">
        <div className="flex gap-3">
          <Compass className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="font-medium">Primeira vez no CeasaPro?</p>
            <p className="text-sm text-muted-foreground">
              Passo uns três minutos com você mostrando para que serve cada tela, com os
              seus próprios dados. Dá para sair no meio.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <BotaoTour size="sm" rotulo="Começar o tour" />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              marcarConvidado();
              setDispensado(true);
            }}
          >
            Já sei usar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
