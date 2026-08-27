"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, KeyRound, Loader2, Power, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  alterarStatusUsuario,
  excluirUsuario,
  resetarSenhaUsuario,
} from "@/actions/admin.actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Ações do super-admin sobre uma conta: ligar/desligar acesso e resetar senha.
 *
 * A senha temporária aparece UMA vez, em diálogo, e nunca é gravada em lugar
 * nenhum além do hash. Quem reseta não escolhe a senha de ninguém: o dono é
 * obrigado a definir a dele no próximo login.
 */
export function AcoesUsuario({
  userId,
  nome,
  ativo,
  ehVoce,
}: {
  userId: string;
  nome: string;
  ativo: boolean;
  /** A própria conta do super-admin: desativar-se travaria o painel. */
  ehVoce: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmando, setConfirmando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [senhaTemp, setSenhaTemp] = useState<string | null>(null);

  function excluir() {
    start(async () => {
      const res = await excluirUsuario(userId);
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success(`${res.data.name} excluído.`);
      setExcluindo(false);
      router.refresh();
    });
  }

  function alternar() {
    start(async () => {
      const res = await alterarStatusUsuario({ userId, active: !ativo });
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success(
        ativo ? `${nome} não consegue mais entrar.` : `${nome} voltou a ter acesso.`,
      );
      router.refresh();
    });
  }

  function resetar() {
    start(async () => {
      const res = await resetarSenhaUsuario(userId);
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      setSenhaTemp(res.data.tempPassword);
      setConfirmando(false);
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex shrink-0 gap-1">
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Resetar senha de ${nome}`}
          title="Resetar senha"
          onClick={() => setConfirmando(true)}
          disabled={pending}
        >
          <KeyRound className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label={ativo ? `Desativar ${nome}` : `Reativar ${nome}`}
          title={ativo ? "Desativar acesso" : "Reativar acesso"}
          onClick={alternar}
          disabled={pending || ehVoce}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Power className={ativo ? "size-4 text-destructive" : "size-4 text-success"} />
          )}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Excluir ${nome}`}
          title="Excluir usuário"
          onClick={() => setExcluindo(true)}
          disabled={pending || ehVoce}
        >
          <Trash2 className="size-4 text-destructive" />
        </Button>
      </div>

      <Dialog open={excluindo} onOpenChange={(o) => !o && setExcluindo(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir {nome}?</DialogTitle>
            <DialogDescription>
              A conta sai da lista e as sessões abertas caem na hora. O histórico de
              auditoria é preservado — é ele que registra o que essa pessoa fez.
              Não é possível excluir o único responsável de uma empresa ativa.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExcluindo(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={excluir} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Excluir usuário
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmando} onOpenChange={(o) => !o && setConfirmando(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resetar a senha de {nome}?</DialogTitle>
            <DialogDescription>
              Uma senha temporária será gerada e mostrada aqui <b>uma única vez</b>. Todas
              as sessões abertas caem, e {nome} terá de definir uma senha nova no próximo
              login.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmando(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={resetar} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Gerar senha temporária
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={senhaTemp !== null} onOpenChange={(o) => !o && setSenhaTemp(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Senha temporária de {nome}</DialogTitle>
            <DialogDescription>
              Copie agora e entregue com segurança — ela <b>não aparece de novo</b>.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted/40 p-3 text-center font-mono text-lg tracking-wider">
            {senhaTemp}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={async () => {
                if (!senhaTemp) return;
                try {
                  await navigator.clipboard.writeText(senhaTemp);
                  toast.success("Senha copiada.");
                } catch {
                  toast.error("Não foi possível copiar. Selecione o texto acima.");
                }
              }}
            >
              <Copy className="size-4" /> Copiar
            </Button>
            <Button onClick={() => setSenhaTemp(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
