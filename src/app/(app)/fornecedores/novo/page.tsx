import { PageHeader } from "@/components/data/page-header";
import { Card } from "@/components/ui/card";
import { FornecedorForm } from "../_components/fornecedor-form";

export default function NovoFornecedorPage() {
  return (
    <div>
      <PageHeader title="Novo fornecedor" />
      <Card className="p-4 sm:p-5">
        <FornecedorForm />
      </Card>
    </div>
  );
}
