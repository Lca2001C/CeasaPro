# Inicia o CeasaPro em modo DESENVOLVIMENTO.
# Uso:  powershell -ExecutionPolicy Bypass -File scripts\dev.ps1
. "$PSScriptRoot\_common.ps1"

Initialize-CeasaPro "dev"

Info "Iniciando em modo desenvolvimento -> http://localhost:3000"
npm run dev
