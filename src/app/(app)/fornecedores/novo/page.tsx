import { PageHeader } from "@/components/data/page-header";
import { FornecedorForm } from "../_components/fornecedor-form";

export default function NovoFornecedorPage() {
  return (
    <div>
      <PageHeader title="Novo fornecedor" />
      <FornecedorForm />
    </div>
  );
}
