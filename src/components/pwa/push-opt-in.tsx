"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Opt-in de notificações.
 *
 * **Separado do convite de instalação de propósito.** São dois pedidos, e juntá-los
 * derruba a aceitação dos dois: quem hesita em instalar recusa o pacote inteiro, e
 * a permissão de notificação, uma vez negada, o navegador NÃO deixa pedir de novo —
 * só nas configurações do próprio navegador, onde ninguém vai. Por isso este botão
 * vive em Configurações, onde a pessoa chega querendo configurar algo.
 *
 * No iPhone há um pré-requisito que não existe no Android: o Web Push só funciona
 * se o app estiver na tela de início (iOS 16.4+). Pedir permissão numa aba do
 * Safari falha, e o usuário conclui que o recurso é quebrado — então aqui isso é
 * dito antes, em vez de deixá-lo descobrir.
 */

type Estado =
  | "carregando"
  | "nao-configurado"
  | "sem-suporte"
  | "precisa-instalar-ios"
  | "negado"
  | "inscrito"
  | "disponivel";

/**
 * base64url (formato da chave VAPID) → ArrayBuffer, que é o que
 * `applicationServerKey` aceita.
 *
 * Devolve ArrayBuffer e não Uint8Array porque em TS 5.7+ o `Uint8Array` genérico
 * (`ArrayBufferLike`) não satisfaz `BufferSource` — o tipo admite
 * `SharedArrayBuffer`, que a API de push não aceita. Pegar o `.buffer` evita um
 * cast que esconderia a diferença.
 */
function chaveParaBytes(base64url: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const bruto = atob(base64);
  const bytes = new Uint8Array(bruto.length);
  for (let i = 0; i < bruto.length; i++) bytes[i] = bruto.charCodeAt(i);
  return bytes.buffer;
}

function lerIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  );
}

function lerInstalado(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** A plataforma e a permissão não mudam sozinhas no meio da sessão. */
const semMudanca = () => () => {};

const lerSuporte = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

const lerPermissao = (): NotificationPermission =>
  typeof Notification === "undefined" ? "default" : Notification.permission;

export function PushOptIn({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const suporte = useSyncExternalStore(semMudanca, lerSuporte, () => false);
  const permissao = useSyncExternalStore(semMudanca, lerPermissao, () => "default" as const);
  const ios = useSyncExternalStore(semMudanca, lerIOS, () => false);
  const instalado = useSyncExternalStore(semMudanca, lerInstalado, () => false);

  /**
   * `null` = ainda consultando. É o único pedaço genuinamente assíncrono: saber se
   * este aparelho já tem inscrição exige `getSubscription()`.
   */
  const [inscrito, setInscrito] = useState<boolean | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // setState em callback de promessa — o uso previsto para efeito. Derivar o
  // resto (em vez de setar tudo aqui) evita render em cascata.
  useEffect(() => {
    if (!suporte) return;
    let vivo = true;
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.pushManager.getSubscription() ?? null)
      .then((sub) => {
        if (vivo) setInscrito(Boolean(sub));
      })
      .catch(() => {
        if (vivo) setInscrito(false);
      });
    return () => {
      vivo = false;
    };
  }, [suporte]);

  /**
   * Estado DERIVADO, na ordem em que os impedimentos importam.
   *
   * `nao-configurado` (sem chave VAPID no servidor) vem antes e é distinto de
   * `sem-suporte` de propósito: é falha nossa, não do aparelho do usuário, e
   * dizer a ele que o navegador não suporta seria mandá-lo procurar defeito onde
   * não há. Já no iPhone sem instalar, `subscribe()` falharia e gastaria a
   * permissão — que só se pede uma vez.
   */
  const estado: Estado = !vapidPublicKey
    ? "nao-configurado"
    : !suporte
      ? "sem-suporte"
      : ios && !instalado
        ? "precisa-instalar-ios"
        : permissao === "denied"
          ? "negado"
          : inscrito === null
            ? "carregando"
            : inscrito
              ? "inscrito"
              : "disponivel";

  const ativar = useCallback(async () => {
    setOcupado(true);
    try {
      const resposta = await Notification.requestPermission();
      if (resposta !== "granted") {
        // Negada é definitiva do ponto de vista da API: o site não pode pedir de
        // novo. A tela reflete isso na próxima renderização, pelo `permissao`.
        setInscrito(false);
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        // Obrigatório nos navegadores atuais: notificação sem conteúdo visível
        // (silenciosa) não é permitida.
        userVisibleOnly: true,
        applicationServerKey: chaveParaBytes(vapidPublicKey!),
      });

      const res = await fetch("/api/pwa/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error("servidor recusou a inscricao");

      setInscrito(true);
      toast.success("Avisos ativados neste aparelho.");
    } catch {
      // Se o servidor recusou, a inscrição do navegador ficaria órfã (ele
      // enviaria para um endpoint que não guardamos). Desfaz para o estado ficar
      // coerente entre navegador e servidor.
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      await sub?.unsubscribe().catch(() => undefined);
      setInscrito(false);
      toast.error("Não foi possível ativar os avisos. Tente de novo.");
    } finally {
      setOcupado(false);
    }
  }, [vapidPublicKey]);

  const desativar = useCallback(async () => {
    setOcupado(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        // Avisa o servidor ANTES de cancelar no navegador: cancelando primeiro,
        // perderíamos o endpoint e a linha ficaria no banco para sempre, sendo
        // tentada pelo cron todo dia.
        await fetch("/api/pwa/push", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => undefined);
        await sub.unsubscribe().catch(() => undefined);
      }
      setInscrito(false);
      toast.success("Avisos desativados neste aparelho.");
    } finally {
      setOcupado(false);
    }
  }, []);

  if (estado === "carregando") return null;

  // Push não configurado no servidor: não há nada que o usuário possa fazer, e
  // anunciar um recurso indisponível só gera dúvida. Quem precisa saber é o
  // operador, e para ele o aviso está no log do `push-server`.
  if (estado === "nao-configurado") return null;

  if (estado === "sem-suporte") {
    return (
      <p className="text-sm text-muted-foreground">
        Este navegador não suporta avisos automáticos.
      </p>
    );
  }

  if (estado === "precisa-instalar-ios") {
    return (
      <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
        No iPhone, os avisos só funcionam com o CeasaPro adicionado à tela de início.
        Use o botão de instalar acima e volte aqui depois.
      </p>
    );
  }

  if (estado === "negado") {
    return (
      <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
        Os avisos estão bloqueados para o CeasaPro neste navegador. Para liberar, é
        preciso mudar nas configurações do próprio navegador — o site não pode pedir
        de novo depois de uma recusa.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Receba aviso de fiado vencido, despesa a vencer e higienização a pagar, mesmo
        com o app fechado.
      </p>
      {estado === "inscrito" ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => void desativar()}
          disabled={ocupado}
          className="self-start"
        >
          {ocupado ? <Loader2 className="size-4 animate-spin" /> : <BellOff className="size-4" />}
          Desativar avisos neste aparelho
        </Button>
      ) : (
        <Button size="sm" onClick={() => void ativar()} disabled={ocupado} className="self-start">
          {ocupado ? <Loader2 className="size-4 animate-spin" /> : <Bell className="size-4" />}
          Ativar avisos neste aparelho
        </Button>
      )}
    </div>
  );
}
