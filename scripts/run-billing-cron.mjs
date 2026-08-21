#!/usr/bin/env node
/**
 * Dispara o cron de billing via HTTP.
 * Usado pelo Cron Job do Render (a Vercel chama /api/cron/billing direto).
 *
 * Exige APP_URL e CRON_SECRET no ambiente do job.
 */
const appUrl = (process.env.APP_URL ?? "").replace(/\/+$/, "");
const secret = process.env.CRON_SECRET ?? "";

if (!appUrl || !secret) {
  console.error("Defina APP_URL e CRON_SECRET no ambiente deste job.");
  process.exit(1);
}

const res = await fetch(`${appUrl}/api/cron/billing`, {
  method: "POST",
  headers: { Authorization: `Bearer ${secret}` },
});

const body = await res.text();
if (!res.ok) {
  console.error(`Cron falhou (${res.status}): ${body}`);
  process.exit(1);
}

console.log(body);
