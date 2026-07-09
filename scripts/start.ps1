# Inicia o CeasaPro em modo PRODUCAO (build + start).
# Uso:  powershell -ExecutionPolicy Bypass -File scripts\start.ps1
. "$PSScriptRoot\_common.ps1"

Initialize-CeasaPro "prod"

Info "Compilando para producao (npm run build)..."
npm run build

Info "Iniciando o servidor de producao -> http://localhost:3000"
npm start
