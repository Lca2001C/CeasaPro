import * as React from "react";
import { EstadoVazio } from "@/components/ui/estado-vazio";

interface Props {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}

/**
 * Nome antigo, mantido para as telas que já o usam. O visual é o do
 * `EstadoVazio` (`components/ui/estado-vazio`), que é o componente de verdade.
 */
export function EmptyState({ title, description, icon, action }: Props) {
  return <EstadoVazio titulo={title} descricao={description} icone={icon} acao={action} />;
}
