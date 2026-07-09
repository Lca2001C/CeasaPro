import { redirect } from "next/navigation";

// O proxy ja redireciona "/" conforme o papel; este e apenas um fallback.
export default function RootPage() {
  redirect("/login");
}
