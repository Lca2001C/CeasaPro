# Inicia o CeasaPro em modo PRODUCAO (preflight + build + start).
# Uso:  powershell -ExecutionPolicy Bypass -File scripts\start.ps1
#       $env:SKIP_PREFLIGHT='1'; powershell ...   # pula a checagem pre-flight
. "$PSScriptRoot\_common.ps1"

Initialize-CeasaPro "prod"

if ($env:SKIP_PREFLIGHT -ne "1") {
  Info "Verificacao pre-flight (npm run preflight)..."
  npm run preflight
} else {
  WarnMsg "SKIP_PREFLIGHT=1 — pulando a verificacao pre-flight."
}

$env:NODE_ENV = "production"

Info "Compilando para producao (npm run build)..."
npm run build

$port = if ($env:PORT) { $env:PORT } else { "3000" }
Info "Iniciando o servidor de producao -> http://localhost:$port"
npm start
