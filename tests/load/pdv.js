// Teste de carga do dia de feira: N donos de box, cada um na SUA empresa,
// alternando entre o PDV, a venda e as telas que se abre entre um cliente e
// outro. Ver tests/load/README.md.
//
//   k6 run -e BASE_URL=http://localhost:3100 -e RODADA=antes tests/load/pdv.js

import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";
import { Counter } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:3100";
const VUS = Number(__ENV.VUS || 100);
const SUBIDA = __ENV.SUBIDA || "2m";
const PLATO = __ENV.PLATO || "10m";
const DESCIDA = __ENV.DESCIDA || "1m";

const usuarios = new SharedArray("usuarios", () => JSON.parse(open("./usuarios.json")));

const recusas429 = new Counter("respostas_429");
const erros5xx = new Counter("respostas_5xx");
const voltouAoLogin = new Counter("sessao_perdida");

export const options = {
  scenarios: {
    feira: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: SUBIDA, target: VUS },
        { duration: PLATO, target: VUS },
        { duration: DESCIDA, target: 0 },
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{tipo:pagina}": ["p(95)<1500"],
    "http_req_duration{name:POST /api/vendas}": ["p(95)<800"],
    "http_req_duration{name:POST /api/auth/login}": ["p(95)<1500"],
    // Sem threshold o k6 não separa a métrica por tela no resumo.
    "http_req_duration{name:GET /vendas/nova}": ["p(95)<1500"],
    "http_req_duration{name:GET /dashboard}": ["p(95)<1500"],
    "http_req_duration{name:GET /estoque}": ["p(95)<1500"],
    "http_req_duration{name:GET /vendas}": ["p(95)<1500"],
    respostas_429: ["count==0"],
    respostas_5xx: ["count==0"],
    sessao_perdida: ["count==0"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function contar(res) {
  if (res.status === 429) recusas429.add(1);
  if (res.status >= 500) erros5xx.add(1);
}

const pausa = () => sleep(3 + Math.random() * 5);

let logado = false;

// Os cookies de sessão vêm com `Secure` (o `next start` roda como produção) e o
// cookie jar do k6 não os devolve em http://localhost. Então o VU guarda os
// cookies ele mesmo e manda o cabeçalho `Cookie` à mão, inclusive os que o
// servidor rotaciona no meio do caminho.
const cookies = {};

function guardarCookies(res) {
  for (const nome of Object.keys(res.cookies)) {
    const c = res.cookies[nome][0];
    if (!c) continue;
    if (c.value === "" || c.max_age < 0) delete cookies[nome];
    else cookies[nome] = c.value;
  }
}

function cabecalhos(extra) {
  const cookie = Object.keys(cookies)
    .map((k) => `${k}=${cookies[k]}`)
    .join("; ");
  return Object.assign({ Cookie: cookie }, extra || {});
}

function entrar(u) {
  for (const k of Object.keys(cookies)) delete cookies[k];
  const res = http.post(`${BASE}/api/auth/login`, JSON.stringify({ email: u.email, password: u.password }), {
    headers: { "Content-Type": "application/json", Origin: BASE },
    tags: { name: "POST /api/auth/login" },
  });
  contar(res);
  guardarCookies(res);
  logado = check(res, { "login 200": (r) => r.status === 200 });
  return logado;
}

function pagina(caminho) {
  const res = http.get(`${BASE}${caminho}`, {
    headers: cabecalhos(),
    redirects: 0,
    tags: { name: `GET ${caminho}`, tipo: "pagina" },
  });
  contar(res);
  guardarCookies(res);
  const local = res.headers.Location || res.headers.location || "";
  if (local.includes("/login")) {
    if (__ENV.DEBUG) console.log(`VU ${__VU} ${caminho} -> ${res.status} ${local} ${JSON.stringify(res.cookies)}`);
    voltouAoLogin.add(1);
    logado = false;
  }
  check(res, { [`${caminho} 200`]: (r) => r.status === 200 });
}

function vender(u) {
  const itens = [];
  const n = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const p = u.produtos[Math.floor(Math.random() * u.produtos.length)];
    if (itens.some((it) => it.productId === p.id)) continue;
    itens.push({ productId: p.id, quantity: 1 + Math.floor(Math.random() * 3), unitPrice: p.preco });
  }
  const res = http.post(
    `${BASE}/api/vendas`,
    JSON.stringify({
      paymentMethod: Math.random() < 0.6 ? "PIX" : "DINHEIRO",
      retirarDepois: false,
      idempotencyKey: uuid(),
      items: itens,
    }),
    {
      headers: cabecalhos({ "Content-Type": "application/json", Origin: BASE }),
      tags: { name: "POST /api/vendas" },
    },
  );
  contar(res);
  guardarCookies(res);
  if (res.status === 401) logado = false;
  const ok = check(res, { "venda 200": (r) => r.status === 200 && r.json("ok") === true });
  if (!ok) console.warn(`venda recusada: ${res.status} ${String(res.body).slice(0, 200)}`);
}

export default function feira() {
  // Cada VU é o dono de UMA empresa: o limite por empresa (120/min) e o
  // isolamento por tenant são os de produção.
  const u = usuarios[(__VU - 1) % usuarios.length];
  if (!logado && !entrar(u)) {
    sleep(5);
    return;
  }

  pagina("/vendas/nova");
  pausa();
  vender(u);
  pausa();
  pagina("/dashboard");
  pausa();
  pagina("/estoque");
  pausa();
  if (Math.random() < 0.3) {
    pagina("/vendas");
    pausa();
  }
}

export function handleSummary(data) {
  const rodada = __ENV.RODADA || "rodada";
  const m = data.metrics;
  const linha = (nome) => {
    const v = m[nome] && m[nome].values;
    return v ? `p50=${Math.round(v.med)}ms p95=${Math.round(v["p(95)"])}ms p99=${Math.round(v["p(99)"])}ms max=${Math.round(v.max)}ms` : "-";
  };
  const nomes = Object.keys(m).filter((k) => k.startsWith("http_req_duration{name:"));
  const texto = [
    `Rodada: ${rodada}`,
    `Requisições: ${m.http_reqs.values.count} (${m.http_reqs.values.rate.toFixed(1)}/s)`,
    `Falhas HTTP: ${(m.http_req_failed.values.rate * 100).toFixed(2)}%`,
    `429: ${m.respostas_429 ? m.respostas_429.values.count : 0}  5xx: ${m.respostas_5xx ? m.respostas_5xx.values.count : 0}  sessão perdida: ${m.sessao_perdida ? m.sessao_perdida.values.count : 0}`,
    `Checks OK: ${(m.checks.values.rate * 100).toFixed(2)}%`,
    `Todas: ${linha("http_req_duration")}`,
    ...nomes.map((k) => `${k.slice(23, -1)}: ${linha(k)}`),
    "",
  ].join("\n");
  return {
    stdout: texto,
    [`tests/load/resultados/${rodada}.json`]: JSON.stringify(data, null, 2),
    [`tests/load/resultados/${rodada}.txt`]: texto,
  };
}
