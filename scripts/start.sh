#!/usr/bin/env bash
# Inicia o CeasaPro em modo PRODUÇÃO (preflight + build + start).
# Uso:  bash scripts/start.sh
#       SKIP_PREFLIGHT=1 bash scripts/start.sh   # pula a checagem pré-flight
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

ceasapro_prepare prod

if [ "${SKIP_PREFLIGHT:-}" != "1" ]; then
  info "Verificação pré-flight (npm run preflight)..."
  npm run preflight
else
  warn "SKIP_PREFLIGHT=1 — pulando a verificação pré-flight."
fi

export NODE_ENV=production

info "Compilando para produção (npm run build)..."
npm run build

info "Iniciando o servidor de produção → http://localhost:${PORT:-3000}"
npm start
