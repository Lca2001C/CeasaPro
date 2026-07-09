# Funções compartilhadas de inicialização do CeasaPro (PowerShell).
# Não execute diretamente — é carregado por scripts\dev.ps1 e scripts\start.ps1.
$ErrorActionPreference = "Stop"

# Vai para a raiz do projeto (pasta acima de scripts/)
$script:Root = Split-Path -Parent $PSScriptRoot
Set-Location $script:Root

function Info($m) { Write-Host "> $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "OK $m" -ForegroundColor Green }
function WarnMsg($m) { Write-Host "! $m" -ForegroundColor Yellow }
function ErrMsg($m)  { Write-Host "X $m" -ForegroundColor Red }

function Initialize-CeasaPro([string]$Mode = "dev") {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    ErrMsg "Node.js nao encontrado. Instale o Node 20+."; exit 1
  }

  # .env
  if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
      Copy-Item ".env.example" ".env"
      WarnMsg "Criei .env a partir de .env.example - revise os segredos antes de usar em producao."
    } else {
      ErrMsg "Arquivo .env nao encontrado e nao ha .env.example."; exit 1
    }
  }

  # Banco local via Docker (apenas se DATABASE_URL apontar para localhost)
  $envText = Get-Content ".env" -Raw
  if ($envText -match 'DATABASE_URL=.*(localhost|127\.0\.0\.1)') {
    if (Get-Command docker -ErrorAction SilentlyContinue) {
      # Se o daemon do Docker nao estiver rodando, tenta abrir o Docker Desktop.
      docker ps *> $null
      if ($LASTEXITCODE -ne 0) {
        $dd = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
        if (Test-Path $dd) {
          Info "Iniciando o Docker Desktop (pode levar ~1 min)..."
          Start-Process $dd
          for ($i = 0; $i -lt 60; $i++) { docker ps *> $null; if ($LASTEXITCODE -eq 0) { break }; Start-Sleep 3 }
        }
      }
      Info "Subindo o banco de dados (Docker)..."
      docker compose up -d *> $null
      Info "Aguardando o banco aceitar conexoes..."
      $ready = $false
      for ($i = 0; $i -lt 30; $i++) {
        docker exec ceasapro-db pg_isready -U postgres *> $null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep 2
      }
      if ($ready) { Ok "Banco pronto." } else { ErrMsg "O banco nao respondeu a tempo."; exit 1 }
    } else {
      WarnMsg "Docker nao encontrado - assumindo que o PostgreSQL ja esta rodando em localhost."
    }
  } else {
    Info "DATABASE_URL nao e local - usando banco remoto (ex.: Neon)."
  }

  # Dependencias
  if (-not (Test-Path "node_modules")) {
    Info "Instalando dependencias (npm install)..."
    npm install
  }

  # Prisma Client - so gera se ainda nao existir (evita conflito de arquivo
  # travado no Windows quando outro servidor ja esta rodando).
  if (-not (Test-Path "node_modules\.prisma\client")) {
    Info "Gerando o Prisma Client..."
    npx prisma generate | Out-Null
    if ($LASTEXITCODE -ne 0) { WarnMsg "Nao consegui gerar o Prisma Client (arquivo em uso). Feche outros servidores e rode: npx prisma generate" }
  }

  # Migrations (--skip-generate evita regenerar o client e travar no Windows)
  if ($Mode -eq "prod") {
    Info "Aplicando migrations (producao)..."
    npx prisma migrate deploy
  } else {
    Info "Aplicando migrations (desenvolvimento)..."
    npx prisma migrate dev --skip-generate
  }

  # Seed (apenas na primeira vez)
  if (-not (Test-Path "node_modules\.ceasapro-seeded")) {
    Info "Populando dados iniciais (super-admin, plano, demo)..."
    npm run db:seed
    New-Item -ItemType File "node_modules\.ceasapro-seeded" | Out-Null
  }

  Ok "Ambiente preparado."
}
