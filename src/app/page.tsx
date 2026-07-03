import { redirect } from "next/navigation";

// O middleware já redireciona "/" conforme o papel; este é apenas um fallback.
export default function RootPage() {
  redirect("/login");
}
