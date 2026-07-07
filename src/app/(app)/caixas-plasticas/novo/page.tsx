import { PageHeader } from "@/components/data/page-header";
import { MovimentoCaixaForm } from "./_components/movimento-form";

export default function NovoMovimentoCaixaPage() {
  return (
    <div>
      <PageHeader
        title="Movimentar caixas"
        description="Entrada, saída para cliente, retorno ou quebra."
      />
      <MovimentoCaixaForm />
    </div>
  );
}
