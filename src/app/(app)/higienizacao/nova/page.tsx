import { PageHeader } from "@/components/data/page-header";
import { HigienizacaoForm } from "./_components/higienizacao-form";

export default function NovaHigienizacaoPage() {
  return (
    <div>
      <PageHeader title="Novo envio para higienização" />
      <HigienizacaoForm />
    </div>
  );
}
