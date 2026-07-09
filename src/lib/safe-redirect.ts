export function safeRedirectPath(
  value: string | null | undefined,
  fallback: string,
): string {
  const candidate = value?.trim();
  if (!candidate) return fallback;
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) {
    return fallback;
  }

  try {
    const url = new URL(candidate, "https://ceasapro.local");
    if (url.origin !== "https://ceasapro.local") return fallback;
    if (url.pathname === "/login" || url.pathname.startsWith("/login/")) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
