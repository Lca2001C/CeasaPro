import { PageHeader } from "@/components/data/page-header";
import { ProdutoForm } from "../_components/produto-form";

export default function NovoProdutoPage() {
  return (
    <div>
      <PageHeader title="Novo produto" />
      <ProdutoForm />
    </div>
  );
}
