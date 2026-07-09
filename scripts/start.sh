#!/usr/bin/env bash
# Inicia o CeasaPro em modo PRODUÇÃO (build + start).
# Uso:  bash scripts/start.sh
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

ceasapro_prepare prod

info "Compilando para produção (npm run build)..."
npm run build

info "Iniciando o servidor de produção → http://localhost:3000"
npm start
