"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Download, Plus, Share, Smartphone, SquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/**
 * Convite para instalar o app / criar atalho na tela inicial.
 *
 * O ganho do PWA (abrir direto, sem barra do navegador, mais rápido no balcão) só
 * existe se o app estiver na tela inicial. Ninguém procura isso no menu do
 * navegador, então o convite tem de ir ao usuário — uma vez, na hora em que ele
 * acabou de entrar e ainda está disposto a configurar algo.
 *
 * Duas plataformas, dois fluxos que NÃO se parecem:
 *
 * - **Android / Chrome / Edge:** o navegador dispara `beforeinstallprompt`. Guardamos
 *   o evento e o botão chama `prompt()` — instalação nativa, um toque.
 * - **iOS / Safari:** `beforeinstallprompt` não existe e não há API para disparar a
 *   instalação nem para saber se o usuário a fez. O único caminho é ensinar o passo
 *   a passo (Compartilhar → Adicionar à Tela de Início). Daí o card com instruções.
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

// ─────────────────── Leitura do ambiente ───────────────────

/** Já está rodando como app instalado? */
function lerInstalado(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  // iOS antigo não expõe display-mode; `standalone` é o sinal dele.
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Assina as duas formas de o app "virar instalado" durante a sessão: a mudança do
 * display-mode e o evento `appinstalled`. Sem isto o convite continuaria aberto
 * depois de o usuário instalar.
 */
function assinarInstalado(notificar: () => void): () => void {
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener("change", notificar);
  window.addEventListener("appinstalled", notificar);
  return () => {
    mq.removeEventListener("change", notificar);
    window.removeEventListener("appinstalled", notificar);
  };
}

function lerIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ se identifica como Mac; o toque é o que o distingue.
  const iPadOSNovo = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || iPadOSNovo;
}

/** A plataforma não muda no meio da sessão: assinatura vazia, de propósito. */
const semMudanca = () => () => {};

/**
 * No iOS, só o Safari adiciona à tela de início com suporte a PWA. Chrome e Firefox
 * no iPhone usam o mesmo motor, mas não oferecem o item no menu — mandar o usuário
 * procurar ali seria mandá-lo procurar o que não existe.
 */
function ehSafariNoIOS(): boolean {
  if (!lerIOS()) return false;
  return !/CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser/.test(navigator.userAgent);
}

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
  const instalado = useSyncExternalStore(assinarInstalado, lerInstalado, () => false);
  const ios = useSyncExternalStore(semMudanca, lerIOS, () => false);

  const [evento, setEvento] = useState<BeforeInstallPromptEvent | null>(null);
  const [fechadoPeloUsuario, setFechadoPeloUsuario] = useState(false);
  const [abertoManual, setAbertoManual] = useState(false);

  // No servidor não há storage: os padrões são os conservadores (não pediu,
  // considerado dispensado), então o HTML do servidor nunca traz o painel aberto.
  const pedido = useSyncExternalStore(semMudanca, lerPedido, () => false);
  const dispensado = useSyncExternalStore(semMudanca, lerDispensado, () => true);

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
   * (sem ele o botão "Instalar" não teria o que chamar); no iOS não há evento
   * algum, então basta ser Safari.
   */
  const podeAbrirAuto =
    autoOpen &&
    !instalado &&
    !dispensado &&
    (pedido || evento !== null || ios) &&
    (!ios || ehSafariNoIOS());

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
    setAbertoManual(true);
  }, []);

  // App já instalado: nada a oferecer, nem o gatilho manual.
  if (instalado) return null;

  // No iOS o passo a passo é a única coisa que existe — não há instalação nativa
  // para oferecer antes dele. Um botão intermediário só somaria um toque.
  const mostrarPassosIOS = ios;

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

            {mostrarPassosIOS ? (
              <>
                <ol className="flex flex-col gap-3 text-sm">
                  <li className="flex items-start gap-3">
                    <Share className="mt-0.5 size-5 shrink-0 text-primary" />
                    <span>
                      Toque em <strong>Compartilhar</strong> na barra do Safari (o quadrado
                      com a seta para cima).
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <SquarePlus className="mt-0.5 size-5 shrink-0 text-primary" />
                    <span>
                      Role a lista e escolha <strong>Adicionar à Tela de Início</strong>.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Plus className="mt-0.5 size-5 shrink-0 text-primary" />
                    <span>
                      Confirme em <strong>Adicionar</strong>. O ícone do CeasaPro aparece
                      junto dos seus outros apps.
                    </span>
                  </li>
                </ol>
                <Button variant="outline" onClick={agoraNao}>
                  Entendi
                </Button>
              </>
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
