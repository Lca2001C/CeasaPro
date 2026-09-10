import { GradeSkeleton } from "@/components/data/lista-skeleton";

/**
 * Contorno da grade de cotações — a tela mais pesada do sistema.
 *
 * Medido com o boletim cheio (215 produtos): ~141 KB de HTML comprimido. É a
 * espera mais longa do app, e era a única sem nada na tela enquanto durava.
 */
export default function Carregando() {
  return <GradeSkeleton />;
}
