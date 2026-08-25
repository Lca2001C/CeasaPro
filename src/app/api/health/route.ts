export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness do processo — para monitoração externa (uptime check, probe).
 * Não consulta o banco de propósito: se o Postgres estiver lento, o orquestrador
 * não entra em loop de restart. A checagem de banco fica no `npm run preflight`.
 */
export async function GET() {
  return Response.json(
    { ok: true, service: "ceasapro" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
