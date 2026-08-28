import { ChangePasswordForm } from "./_components/change-password-form";

// Renderizada por requisição para receber o nonce do CSP (ver `src/proxy.ts`).
// Aqui isso é crítico, não cosmético: esta é a ÚNICA tela acessível a quem tem
// `mustChangePassword` (o proxy trava todo o resto). Pré-renderizada em build, o
// HTML sairia sem nonce, o `'strict-dynamic'` bloquearia o JS do formulário e o
// usuário ficaria sem nenhuma saída — não conseguiria trocar a senha nem usar o
// sistema. O formulário foi movido para `_components/` porque route segment
// config não é lido de arquivo `"use client"`.
export const dynamic = "force-dynamic";

export default function ChangePasswordPage() {
  return <ChangePasswordForm />;
}
