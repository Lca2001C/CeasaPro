import Link from "next/link";
import { Plus } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * A ação principal de um módulo ("Adicionar Novo Produto", "Registrar Nova
 * Venda"…): um cartão verde largo logo abaixo do título, e não um botão
 * pequeno no canto do cabeçalho. É o caminho mais usado de cada tela, então é
 * o alvo maior dela — e todos os módulos têm a mesma cara para que a pessoa
 * reconheça "é aqui que eu lanço" sem procurar.
 *
 * Com `href` é link; com `onClick` (componente de cliente, ex.: abrir uma
 * folha) é botão.
 */

const CLASSES =
  "mb-4 flex w-full items-center justify-between gap-3 rounded-xl border-2 border-primary/30 bg-gradient-to-r from-primary to-primary/80 p-4 text-left text-primary-foreground shadow-sm transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Props = {
  titulo: string;
  descricao: string;
  icone?: React.ReactNode;
  className?: string;
  "data-tour"?: string;
} & (
  | { href: string; scroll?: boolean; onClick?: never }
  | { onClick: () => void; href?: never; scroll?: never }
);

function Conteudo({ titulo, descricao, icone }: Pick<Props, "titulo" | "descricao" | "icone">) {
  return (
    <>
      <span className="min-w-0">
        <span className="block text-lg font-bold">{titulo}</span>
        <span className="block text-sm opacity-90">{descricao}</span>
      </span>
      <span
        aria-hidden
        className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-foreground/20 [&_svg]:size-6"
      >
        {icone ?? <Plus />}
      </span>
    </>
  );
}

export function CartaoDeAcao(props: Props) {
  const { titulo, descricao, icone, className } = props;
  // Sem alvo próprio, é a "ação da tela" do tour — o lugar que antes era do
  // botão no `PageHeader` (ver `ACAO` em `lib/tour/roteiro.ts`).
  const tour = props["data-tour"] ?? "acao-da-tela";
  const conteudo = <Conteudo titulo={titulo} descricao={descricao} icone={icone} />;
  if (props.href !== undefined) {
    return (
      <Link
        href={props.href}
        scroll={props.scroll}
        data-tour={tour}
        className={cn(CLASSES, className)}
      >
        {conteudo}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={props.onClick}
      data-tour={tour}
      className={cn(CLASSES, className)}
    >
      {conteudo}
    </button>
  );
}
