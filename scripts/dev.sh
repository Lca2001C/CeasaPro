#!/usr/bin/env bash
# Inicia o CeasaPro em modo DESENVOLVIMENTO.
# Uso:  bash scripts/dev.sh
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

ceasapro_prepare dev

info "Iniciando em modo desenvolvimento → http://localhost:3000"
npm run dev
