#!/usr/bin/env bash
# Funções compartilhadas de inicialização do CeasaPro (Bash).
# Não execute diretamente — é carregado por scripts/dev.sh e scripts/start.sh.
set -euo pipefail

# Vai para a raiz do projeto (pasta acima de scripts/)
cd "$(dirname "${BASH_SOURCE[0]}")/.."

info() { printf "\033[36m›\033[0m %s\n" "$1"; }
ok()   { printf "\033[32m✔\033[0m %s\n" "$1"; }
warn() { printf "\033[33m⚠\033[0m %s\n" "$1"; }
err()  { printf "\033[31m✖\033[0m %s\n" "$1" >&2; }

# Garante node/npm/npx no PATH (Git Bash e WSL no Windows não herdam o PATH do sistema).
ceasapro_ensure_node() {
  if command -v node >/dev/null 2>&1; then
    return 0
  fi

  local dir
  for dir in \
    "/c/Program Files/nodejs" \
    "/c/Program Files (x86)/nodejs" \
    "/mnt/c/Program Files/nodejs" \
    "/mnt/c/Program Files (x86)/nodejs"
  do
    if [ -f "$dir/node.exe" ] || [ -f "$dir/node" ]; then
      export PATH="$dir:$PATH"
      if command -v node >/dev/null 2>&1 || command -v node.exe >/dev/null 2>&1; then
        warn "Node.js encontrado em $dir — adicionado ao PATH desta sessão."
        return 0
      fi
    fi
  done

  err "Node.js não encontrado. Instale o Node 22+ (https://nodejs.org) ou use scripts/start.ps1 no Windows."
  exit 1
}

ceasapro_prepare() {
  local mode="${1:-dev}"

  ceasapro_ensure_node

  # .env
  if [ ! -f .env ]; then
    if [ -f .env.example ]; then
      cp .env.example .env
      warn "Criei .env a partir de .env.example — revise os segredos antes de usar em produção."
    else
      err "Arquivo .env não encontrado e não há .env.example."; exit 1
    fi
  fi

  # Banco local via Docker (apenas se DATABASE_URL apontar para localhost)
  if grep -qsE 'DATABASE_URL=.*(localhost|127\.0\.0\.1)' .env; then
    if command -v docker >/dev/null 2>&1; then
      info "Subindo o banco de dados (Docker)..."
      docker compose up -d >/dev/null 2>&1 || {
        err "Não consegui subir o Docker. O Docker Desktop está aberto?"; exit 1;
      }
      info "Aguardando o banco aceitar conexões..."
      local ready=0 i
      for i in $(seq 1 30); do
        if docker exec ceasapro-db pg_isready -U postgres >/dev/null 2>&1; then ready=1; break; fi
        sleep 2
      done
      [ "$ready" = "1" ] && ok "Banco pronto." || { err "O banco não respondeu a tempo."; exit 1; }
    else
      warn "Docker não encontrado — assumindo que o PostgreSQL já está rodando em localhost."
    fi
  else
    info "DATABASE_URL não é local — usando banco remoto (ex.: Neon)."
  fi

  # Dependências
  if [ ! -d node_modules ]; then
    info "Instalando dependências (npm install)..."
    npm install
  fi

  # Prisma Client — só gera se ainda não existir (evita conflito de arquivo
  # travado no Windows quando outro servidor já está rodando).
  if [ ! -d node_modules/.prisma/client ]; then
    info "Gerando o Prisma Client..."
    npx prisma generate >/dev/null || warn "Não consegui gerar o Prisma Client (arquivo em uso). Feche outros servidores e rode: npx prisma generate"
  fi

  # Migrations (--skip-generate evita regenerar o client e travar no Windows)
  if [ "$mode" = "prod" ]; then
    info "Aplicando migrations (produção)..."
    npx prisma migrate deploy
  else
    info "Aplicando migrations (desenvolvimento)..."
    npx prisma migrate dev --skip-generate
  fi

  # Seed automático só em desenvolvimento (em produção rode npm run db:seed manualmente, uma vez).
  if [ "$mode" = "dev" ] && [ ! -f node_modules/.ceasapro-seeded ]; then
    info "Populando dados iniciais (super-admin, plano, demo)..."
    npm run db:seed
    touch node_modules/.ceasapro-seeded
  fi

  ok "Ambiente preparado."
}
