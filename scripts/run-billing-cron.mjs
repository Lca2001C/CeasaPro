#!/usr/bin/env node
/**
 * Dispara o cron de billing via HTTP, à mão, contra qualquer ambiente.
 *
 * Em produção quem chama /api/cron/billing é o cron da Vercel (vercel.json).
 * Este script serve para rodar a cobrança na hora — testar uma reconciliação,
 * ou reprocessar depois de um incidente — sem esperar as 6h da manhã.
 *
 * Uso:  APP_URL=... CRON_SECRET=... npm run cron:billing
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
