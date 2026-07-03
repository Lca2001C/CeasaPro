import { headers } from "next/headers";

/** IP do cliente a partir dos headers (para auditoria/rate-limit). */
export async function clientIp(): Promise<string | null> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return h.get("x-real-ip") ?? null;
}

export async function userAgent(): Promise<string | null> {
  const h = await headers();
  return h.get("user-agent");
}
