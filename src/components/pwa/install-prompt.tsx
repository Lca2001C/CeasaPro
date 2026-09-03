"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Bell, Check, Copy, Download, Plus, Share, Smartphone, SquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  assinarInstalado,
  estaInstalado,
  plataformaAtual,
  semMudanca,
} from "@/lib/pwa/plataforma";

/**
 * Convite para instalar o app / criar atalho na tela inicial.
 *
 * O ganho do PWA (abrir direto, sem barra do navegador, mais rápido no balcão) só
 * existe se o app estiver na tela inicial. Ninguém procura isso no menu do
 * navegador, então o convite tem de ir ao usuário — uma vez, na hora em que ele
 * acabou de entrar e ainda está disposto a configurar algo.
 *
 * Três plataformas, três caminhos que NÃO se parecem (ver `lib/pwa/plataforma`):
 *
 * - **Android / Chrome / Edge:** o navegador dispara `beforeinstallprompt`. Guardamos
 *   o evento e o botão chama `prompt()` — instalação nativa, um toque.
 * - **Safari no iPhone:** `beforeinstallprompt` não existe e não há API para disparar a
 *   instalação nem para saber se o usuário a fez. O único caminho é ensinar o passo
 *   a passo (Compartilhar → Adicionar à Tela de Início). Daí o card com instruções.
 * - **Chrome/Firefox/Edge no iPhone:** nem o passo a passo existe ali. Ensinar
 *   "Compartilhar → Adicionar à Tela de Início" nesses navegadores é mandar o
 *   comerciante procurar um item de menu que o aparelho dele não tem — por isso
 *   este caso ganhou tela própria, que manda abrir no Safari.
 *
 * Sobre a forma do componente: o estado do ambiente (app já instalado, plataforma)
 * é lido com `useSyncExternalStore`, e a abertura automática é DERIVADA em vez de
 * setada dentro de um efeito. Não é preferência de estilo — `setState` síncrono em
 * efeito provoca render em cascata, e aqui produziria um piscar do painel na
 * primeira tela depois do login.
 *
 * Ver `docs/10-pwa-evolucao.md` para os limites do iOS.
 */

const CHAVE_DISPENSADO = "pwa-install-dismissed-at";
const CHAVE_MOSTRAR = "pwa-show-install";
const DIAS_DE_SILENCIO = 7;

/** Evento do Chromium; não está no lib.dom padrão. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * O passo a passo do iPhone, numerado.
 *
 * Numerado porque é uma sequência dentro de um menu do sistema que o usuário não
 * conhece: sem a ordem explícita, os três ícones parecem três opções entre as
 * quais escolher uma.
 */
const PASSOS_IOS = [
  {
    icone: Share,
    texto: (
      <>
        Toque em <strong>Compartilhar</strong> na barra do Safari (o quadrado com a seta
        para cima).
      </>
    ),
  },
  {
    icone: SquarePlus,
    texto: (
      <>
        Role a lista e escolha <strong>Adicionar à Tela de Início</strong>.
      </>
    ),
  },
  {
    icone: Plus,
    texto: (
      <>
        Confirme em <strong>Adicionar</strong>. O ícone do CeasaPro aparece junto dos
        seus outros apps.
      </>
    ),
  },
] as const;

// ─────────────────── Memória entre sessões ───────────────────

/** Dispensado nos últimos 7 dias? */
function foiDispensadoRecentemente(): boolean {
  try {
    const bruto = localStorage.getItem(CHAVE_DISPENSADO);
    if (!bruto) return false;
    const quando = Number(bruto);
    if (!Number.isFinite(quando)) return false;
    return Date.now() - quando < DIAS_DE_SILENCIO * 24 * 60 * 60 * 1000;
  } catch {
    // Armazenamento bloqueado (aba privada, política do dispositivo): preferimos
    // NÃO insistir a arriscar mostrar o convite em cada navegação.
    return true;
  }
}

function marcarDispensado() {
  try {
    localStorage.setItem(CHAVE_DISPENSADO, String(Date.now()));
  } catch {
    // Sem armazenamento não há como lembrar; o convite pode reaparecer.
  }
}

/** O login pede o convite para a próxima tela (ver `login-form.tsx`). */
export function pedirPromptDeInstalacao() {
  try {
    sessionStorage.setItem(CHAVE_MOSTRAR, "1");
  } catch {
    // Sem sessionStorage o convite ainda pode abrir pelo caminho normal.
  }
}

function lerPedidoDeInstalacao(): boolean {
  try {
    return sessionStorage.getItem(CHAVE_MOSTRAR) === "1";
  } catch {
    return false;
  }
}

/**
 * Decisão de entrada (pediu pelo login? já dispensou?), lida UMA vez por
 * carregamento de página e cacheada.
 *
 * O cache existe para o snapshot ser ESTÁVEL: `useSyncExternalStore` relê o
 * getSnapshot a cada render, e se ele voltasse a consultar o storage, marcar
 * "Agora não" (que escreve no localStorage) mudaria o valor no meio do ciclo e
 * fecharia o painel de um jeito difícil de explicar. Cada navegação recria o
 * módulo, então a decisão é reavaliada na página seguinte — que é o que se quer.
 */
let entradaCache: { pedido: boolean; dispensado: boolean } | null = null;

function lerEntrada(): { pedido: boolean; dispensado: boolean } {
  if (entradaCache === null) {
    entradaCache = {
      pedido: lerPedidoDeInstalacao(),
      dispensado: foiDispensadoRecentemente(),
    };
  }
  return entradaCache;
}

const lerPedido = () => lerEntrada().pedido;
const lerDispensado = () => lerEntrada().dispensado;

/** Domínio a ditar para quem precisa trocar de navegador. Vazio no servidor. */
const lerHost = () => (typeof window === "undefined" ? "" : window.location.host);

function limparPedidoDeInstalacao() {
  try {
    sessionStorage.removeItem(CHAVE_MOSTRAR);
  } catch {
    /* nada a limpar */
  }
}

// ─────────────────── Componente ───────────────────

export function InstallPrompt({
  /** Abre sozinho no primeiro acesso pós-login. */
  autoOpen = false,
  /**
   * Rótulo de um gatilho visível (Configurações, menu "Mais"). Quando ausente, o
   * componente é invisível e só abre sozinho.
   *
   * É um rótulo, e não `children`, de propósito: envolver um `<Button>` recebido
   * por children num `<button>` produz interativo dentro de interativo — HTML
   * inválido, dois elementos com role de botão e navegação por teclado confusa.
   */
  triggerLabel,
}: {
  autoOpen?: boolean;
  triggerLabel?: string;
}) {
  const instalado = useSyncExternalStore(assinarInstalado, estaInstalado, () => false);
  const plataforma = useSyncExternalStore(semMudanca, plataformaAtual, () => "outro" as const);

  const [evento, setEvento] = useState<BeforeInstallPromptEvent | null>(null);
  const [fechadoPeloUsuario, setFechadoPeloUsuario] = useState(false);
  const [abertoManual, setAbertoManual] = useState(false);
  const [enderecoCopiado, setEnderecoCopiado] = useState(false);

  // No servidor não há storage: os padrões são os conservadores (não pediu,
  // considerado dispensado), então o HTML do servidor nunca traz o painel aberto.
  const pedido = useSyncExternalStore(semMudanca, lerPedido, () => false);
  const dispensado = useSyncExternalStore(semMudanca, lerDispensado, () => true);
  const host = useSyncExternalStore(semMudanca, lerHost, () => "");

  // Assinatura do evento do navegador: setState em CALLBACK de evento externo é
  // exatamente o uso previsto para efeito.
  useEffect(() => {
    function onBeforeInstall(e: Event) {
      // Sem `preventDefault` o Chrome mostra a barra dele por cima da nossa.
      e.preventDefault();
      setEvento(e as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  // A flag do login é de uso único: consumir é atualizar sistema externo.
  useEffect(() => {
    if (pedido) limparPedidoDeInstalacao();
  }, [pedido]);

  /**
   * Abertura DERIVADA, não setada. No Android depende do `beforeinstallprompt`
   * (sem ele o botão "Instalar" não teria o que chamar); no Safari do iPhone não
   * há evento algum, então basta a plataforma.
   *
   * `ios-outro` nunca abre sozinho: ali o convite não tem ação a oferecer, só o
   * pedido de trocar de navegador. Interromper a primeira tela depois do login
   * para isso é custo sem retorno — quem quiser instalar chega pelo gatilho de
   * Configurações, que continua funcionando nesses navegadores.
   */
  const podeAbrirAuto =
    autoOpen &&
    !instalado &&
    !dispensado &&
    plataforma !== "ios-outro" &&
    (pedido || evento !== null || plataforma === "ios-safari");

  const aberto = abertoManual || (podeAbrirAuto && !fechadoPeloUsuario);

  const fechar = useCallback((proximo: boolean) => {
    if (proximo) return;
    setAbertoManual(false);
    setFechadoPeloUsuario(true);
  }, []);

  const instalar = useCallback(async () => {
    if (!evento) return;
    await evento.prompt();
    const { outcome } = await evento.userChoice;
    setEvento(null);
    setAbertoManual(false);
    setFechadoPeloUsuario(true);
    // Recusa na caixa do navegador também é "agora não": ele não volta a oferecer
    // por um tempo, e insistir aqui seria pedir o que já foi negado.
    if (outcome === "dismissed") marcarDispensado();
  }, [evento]);

  const agoraNao = useCallback(() => {
    marcarDispensado();
    setAbertoManual(false);
    setFechadoPeloUsuario(true);
  }, []);

  const abrirManual = useCallback(() => {
    setFechadoPeloUsuario(false);
    setEnderecoCopiado(false);
    setAbertoManual(true);
  }, []);

  /**
   * Copia o endereço para o usuário colar no Safari. Não existe forma de abrir
   * outro navegador a partir da página, e digitar um domínio à mão no celular é
   * onde essa jornada morre.
   *
   * Falha em silêncio de propósito: a área de transferência pode estar bloqueada
   * por política do aparelho, e o endereço está escrito no texto acima — o
   * usuário ainda consegue seguir sem o atalho.
   */
  const copiarEndereco = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setEnderecoCopiado(true);
    } catch {
      setEnderecoCopiado(false);
    }
  }, []);

  // App já instalado: nada a oferecer, nem o gatilho manual.
  if (instalado) return null;

  return (
    <>
      {triggerLabel && (
        <Button variant="outline" size="sm" onClick={abrirManual}>
          <Smartphone className="size-4" />
          {triggerLabel}
        </Button>
      )}

      <Sheet open={aberto} onOpenChange={fechar}>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>Use o CeasaPro como app no celular</SheetTitle>
          </SheetHeader>

          <div className="flex flex-col gap-4 p-4 pt-0">
            <p className="text-sm text-muted-foreground">
              Adicione um atalho na tela inicial para abrir direto — mais rápido na hora
              de vender.
            </p>

            {plataforma === "ios-safari" ? (
              <>
                <ol className="flex flex-col gap-3 text-sm">
                  {PASSOS_IOS.map(({ icone: Icone, texto }, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                        {i + 1}
                      </span>
                      <Icone className="mt-0.5 size-5 shrink-0 text-primary" />
                      <span>{texto}</span>
                    </li>
                  ))}
                </ol>
                {/*
                  Ponte para a Fase 3. No iPhone o Web Push só funciona com o app
                  na tela de início, e quem não souber disso ativa os avisos numa
                  aba do Safari, falha, e conclui que o recurso é quebrado. O
                  momento de contar é agora, que é quando ele acabou de instalar.
                */}
                <p className="flex items-start gap-2 rounded-md bg-muted p-3 text-xs text-muted-foreground">
                  <Bell className="mt-0.5 size-4 shrink-0" />
                  <span>
                    Depois de adicionar, abra o CeasaPro <strong>pelo ícone</strong>. É
                    só assim que o iPhone deixa ligar os avisos de fiado e despesa
                    vencendo, em Configurações.
                  </span>
                </p>
                <Button variant="outline" onClick={agoraNao}>
                  Entendi
                </Button>
              </>
            ) : plataforma === "ios-outro" ? (
              <div className="flex flex-col gap-2">
                <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                  No iPhone, só o <strong>Safari</strong> consegue criar o atalho na tela
                  inicial. Abra o Safari, entre em <strong>{host}</strong> e o passo a
                  passo aparece por lá.
                </p>
                <Button variant="outline" onClick={() => void copiarEndereco()}>
                  {enderecoCopiado ? (
                    <>
                      <Check className="size-4" />
                      Endereço copiado
                    </>
                  ) : (
                    <>
                      <Copy className="size-4" />
                      Copiar o endereço
                    </>
                  )}
                </Button>
                <Button variant="ghost" onClick={agoraNao}>
                  Agora não
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {evento ? (
                  <Button size="lg" onClick={() => void instalar()}>
                    <Download className="size-4" />
                    Instalar agora
                  </Button>
                ) : (
                  // Navegador sem suporte: explicar em vez de mostrar um botão que
                  // não faria nada.
                  <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                    Este navegador não oferece instalação. Abra o CeasaPro no Chrome, no
                    Edge ou no Safari do iPhone para criar o atalho.
                  </p>
                )}
                <Button variant="ghost" onClick={agoraNao}>
                  Agora não
                </Button>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
