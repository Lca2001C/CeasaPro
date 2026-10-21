<#
.SYNOPSIS
  Backup CRIPTOGRAFADO do banco de PRODUCAO do CeasaPro (Neon) com pg_dump, numa
  pasta local FORA do OneDrive (padrao: C:\Backups\CeasaPro).

.DESCRIPTION
  Uma vez so:
    .\scripts\backup-producao.ps1 -Configurar   # connection string + senha do backup
    .\scripts\backup-producao.ps1 -Agendar      # tarefa no Agendador: de 3 em 3 dias

  Depois:
    .\scripts\backup-producao.ps1               # backup agora (e o que a tarefa roda)
    .\scripts\backup-producao.ps1 -Decifrar C:\Backups\CeasaPro\arquivo.dump.cpbk
                                                # gera o .dump para restaurar
    .\scripts\backup-producao.ps1 -Desagendar   # remove a tarefa

  POR QUE CRIPTOGRAFADO E FORA DO ONEDRIVE: o dump tem o banco de TODOS os
  clientes (nomes e telefones do fiado, CNPJ, hashes de senha). Numa pasta
  sincronizada ele ia para a nuvem, em claro, em 20 copias.

  A SENHA DO BACKUP e escolhida por voce no -Configurar. A chave de cada arquivo
  sai dela (PBKDF2-SHA256, 200 mil iteracoes) - nao do Windows. Guarde a senha
  num lugar seguro FORA deste PC: sem ela, nenhum backup pode ser aberto, e se o
  PC morrer e a senha so estiver nele, os backups morrem junto.

  Formato do .cpbk: "CPBK1" | sal(16) | iv(16) | AES-256-CBC(dump) | HMAC-SHA256(32)
  sobre tudo o que vem antes. O -Decifrar confere o HMAC antes de decifrar.

  A connection string e a senha ficam em %LOCALAPPDATA%\CeasaPro\, criptografadas
  para este usuario do Windows (DPAPI) - so para a tarefa agendada rodar sozinha.

  pg_dump: usa o instalado (PATH ou C:\Program Files\PostgreSQL\<versao>\bin). Sem
  ele, roda a imagem postgres:18-alpine no Docker.

  Restaurar:
    .\scripts\backup-producao.ps1 -Decifrar <arquivo.dump.cpbk>
    pg_restore --no-owner --no-privileges --dbname "<url de destino>" <arquivo.dump>

  Este arquivo e so ASCII de proposito: o Windows PowerShell 5.1 le .ps1 sem BOM como ANSI.
#>
[CmdletBinding()]
param(
  [switch]$Configurar,
  [switch]$Agendar,
  [switch]$Desagendar,
  # Arquivo .cpbk a decifrar (gera o .dump ao lado, ou em -Saida).
  [string]$Decifrar,
  [string]$Saida,
  # Pasta dos backups. Padrao: C:\Backups\CeasaPro. Pasta do OneDrive e recusada.
  [string]$Destino = "C:\Backups\CeasaPro",
  # Quantos backups manter. 20 x 3 dias = uns 2 meses.
  [int]$Manter = 20,
  # Horario da tarefa. Se o PC estiver desligado, roda assim que ligar (StartWhenAvailable).
  [string]$Horario = "12:00"
)

$ErrorActionPreference = "Stop"
$TaskName  = "CeasaPro - Backup do banco de producao"
$CredDir   = Join-Path $env:LOCALAPPDATA "CeasaPro"
$CredFile  = Join-Path $CredDir "backup-db-url.xml"
$SenhaFile = Join-Path $CredDir "backup-senha.xml"
$PgImage   = "postgres:18-alpine"
$Prefixo   = "ceasapro-producao-"
$Magic     = [Text.Encoding]::ASCII.GetBytes("CPBK1")
$Iteracoes = 200000

# Parametros de URL que o libpq entende. O resto (schema, pgbouncer, connection_limit,
# pool_timeout... que sao do Prisma) faz o pg_dump recusar a URL.
$ParamsLibpq = @("sslmode", "sslrootcert", "channel_binding", "options", "application_name", "connect_timeout")

function Test-PastaSincronizada([string]$Pasta) {
  $cheio = [IO.Path]::GetFullPath($Pasta).TrimEnd('\') + '\'
  $raizes = @($env:OneDrive, $env:OneDriveCommercial, $env:OneDriveConsumer) | Where-Object { $_ }
  foreach ($r in $raizes) {
    if ($cheio.StartsWith(([IO.Path]::GetFullPath($r).TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) { return $true }
  }
  return ($cheio -match '\\OneDrive( - [^\\]+)?\\')
}

function Get-PastaDestino {
  if (Test-PastaSincronizada $Destino) {
    throw "A pasta $Destino fica dentro do OneDrive. Use uma pasta local (ex.: C:\Backups\CeasaPro) ou um disco externo."
  }
  New-Item -ItemType Directory -Force -Path $Destino | Out-Null
  return $Destino
}

function ConvertTo-Texto([Security.SecureString]$Sec) {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Sec)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# Separa a senha do banco (vai por PGPASSWORD, nao aparece na linha de comando) e limpa a URL.
function ConvertTo-Conexao([string]$Url) {
  $Url = $Url.Trim().Trim('"').Trim("'")
  if ($Url -notmatch '^postgres(ql)?://') { throw "Connection string invalida: precisa comecar com postgresql://" }
  $u = [Uri]$Url
  $nomeHost = $u.Host
  if ($nomeHost -match '^(localhost|127\.0\.0\.1|::1)$') {
    throw "A URL aponta para $nomeHost - isto e o banco local, nao producao."
  }
  # O pooler do Neon (PgBouncer em modo transacao) nao serve para pg_dump; o endpoint direto e o mesmo host sem "-pooler".
  if ($nomeHost -match '-pooler\.') { $nomeHost = $nomeHost -replace '-pooler\.', '.' }

  $partes  = $u.UserInfo.Split(':', 2)
  $usuario = $partes[0]
  $senha   = if ($partes.Count -gt 1) { [Uri]::UnescapeDataString($partes[1]) } else { "" }
  $porta   = if ($u.Port -gt 0) { $u.Port } else { 5432 }
  $banco   = $u.AbsolutePath.TrimStart('/')
  if (-not $usuario -or -not $banco) { throw "Connection string sem usuario ou sem nome do banco." }

  $query = [ordered]@{}
  foreach ($par in $u.Query.TrimStart('?').Split('&')) {
    if (-not $par) { continue }
    $kv = $par.Split('=', 2)
    if ($ParamsLibpq -contains $kv[0]) { $query[$kv[0]] = if ($kv.Count -gt 1) { $kv[1] } else { "" } }
  }
  if (-not $query.Contains("sslmode")) { $query["sslmode"] = "require" }
  $qs = ($query.Keys | ForEach-Object { "$_=$($query[$_])" }) -join '&'

  return [pscustomobject]@{
    Url   = "postgresql://${usuario}@${nomeHost}:${porta}/${banco}?${qs}"
    Senha = $senha
    Host  = $nomeHost
    Banco = $banco
  }
}

# ---------------------------------------------------------------- criptografia
function Get-Chaves([string]$Senha, [byte[]]$Sal) {
  $kdf = New-Object Security.Cryptography.Rfc2898DeriveBytes($Senha, $Sal, $Iteracoes, [Security.Cryptography.HashAlgorithmName]::SHA256)
  try {
    $bytes = $kdf.GetBytes(64)
    return @{ Cifra = $bytes[0..31]; Mac = $bytes[32..63] }
  } finally { $kdf.Dispose() }
}

function Get-HmacDoArquivo([string]$Arquivo, [byte[]]$ChaveMac, [long]$Tamanho) {
  $hmac = New-Object Security.Cryptography.HMACSHA256 (,$ChaveMac)
  $fs = [IO.File]::OpenRead($Arquivo)
  try {
    $buf = New-Object byte[] 1048576
    $restante = $Tamanho
    while ($restante -gt 0) {
      $n = $fs.Read($buf, 0, [Math]::Min($buf.Length, $restante))
      if ($n -le 0) { throw "Arquivo terminou antes do esperado." }
      [void]$hmac.TransformBlock($buf, 0, $n, $null, 0)
      $restante -= $n
    }
    [void]$hmac.TransformFinalBlock((New-Object byte[] 0), 0, 0)
    return $hmac.Hash
  } finally { $fs.Dispose(); $hmac.Dispose() }
}

function Protect-Arquivo([string]$Entrada, [string]$Saida, [string]$Senha) {
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $sal = New-Object byte[] 16; $iv = New-Object byte[] 16
  $rng.GetBytes($sal); $rng.GetBytes($iv); $rng.Dispose()
  $k = Get-Chaves $Senha $sal
  $aes = [Security.Cryptography.Aes]::Create()
  $aes.Key = [byte[]]$k.Cifra; $aes.IV = $iv
  $aes.Mode = [Security.Cryptography.CipherMode]::CBC
  $aes.Padding = [Security.Cryptography.PaddingMode]::PKCS7
  $out = [IO.File]::Create($Saida)
  try {
    $out.Write($Magic, 0, $Magic.Length); $out.Write($sal, 0, 16); $out.Write($iv, 0, 16)
    $cs = New-Object Security.Cryptography.CryptoStream($out, $aes.CreateEncryptor(), [Security.Cryptography.CryptoStreamMode]::Write)
    $in = [IO.File]::OpenRead($Entrada)
    try { $in.CopyTo($cs) } finally { $in.Dispose() }
    $cs.FlushFinalBlock()
    $cs.Dispose()   # fecha $out tambem
  } finally { $aes.Dispose(); if ($out.CanWrite) { $out.Dispose() } }
  $tamanho = (Get-Item -LiteralPath $Saida).Length
  $mac = Get-HmacDoArquivo $Saida ([byte[]]$k.Mac) $tamanho
  $fs = [IO.File]::Open($Saida, [IO.FileMode]::Append)
  try { $fs.Write($mac, 0, $mac.Length) } finally { $fs.Dispose() }
}

function Unprotect-Arquivo([string]$Entrada, [string]$Saida, [string]$Senha) {
  $total = (Get-Item -LiteralPath $Entrada).Length
  if ($total -lt ($Magic.Length + 32 + 16 + 32)) { throw "Arquivo pequeno demais para ser um backup .cpbk." }
  $fs = [IO.File]::OpenRead($Entrada)
  try {
    $cab = New-Object byte[] ($Magic.Length + 32)
    [void]$fs.Read($cab, 0, $cab.Length)
    $fs.Position = $total - 32
    $macGravado = New-Object byte[] 32
    [void]$fs.Read($macGravado, 0, 32)
  } finally { $fs.Dispose() }
  if ([Text.Encoding]::ASCII.GetString($cab, 0, $Magic.Length) -ne "CPBK1") { throw "Nao e um backup .cpbk do CeasaPro." }
  $sal = $cab[$Magic.Length..($Magic.Length + 15)]
  $iv  = $cab[($Magic.Length + 16)..($Magic.Length + 31)]
  $k = Get-Chaves $Senha ([byte[]]$sal)
  $mac = Get-HmacDoArquivo $Entrada ([byte[]]$k.Mac) ($total - 32)
  $iguais = $true
  for ($i = 0; $i -lt 32; $i++) { if ($mac[$i] -ne $macGravado[$i]) { $iguais = $false } }
  if (-not $iguais) { throw "Senha errada ou arquivo corrompido (o HMAC nao confere)." }

  $aes = [Security.Cryptography.Aes]::Create()
  $aes.Key = [byte[]]$k.Cifra; $aes.IV = [byte[]]$iv
  $aes.Mode = [Security.Cryptography.CipherMode]::CBC
  $aes.Padding = [Security.Cryptography.PaddingMode]::PKCS7
  $in = [IO.File]::OpenRead($Entrada)
  $out = [IO.File]::Create($Saida)
  try {
    $in.Position = $Magic.Length + 32
    $dec = $aes.CreateDecryptor()
    $cs = New-Object Security.Cryptography.CryptoStream($out, $dec, [Security.Cryptography.CryptoStreamMode]::Write)
    $buf = New-Object byte[] 1048576
    $restante = $total - 32 - $in.Position
    while ($restante -gt 0) {
      $n = $in.Read($buf, 0, [Math]::Min($buf.Length, $restante))
      if ($n -le 0) { break }
      $cs.Write($buf, 0, $n)
      $restante -= $n
    }
    $cs.FlushFinalBlock()
    $cs.Dispose()
  } finally { $in.Dispose(); $aes.Dispose(); if ($out.CanWrite) { $out.Dispose() } }
}

# ---------------------------------------------------------------- pg_dump
function Find-PgDump {
  $cmd = Get-Command pg_dump -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $exe = Get-ChildItem "$env:ProgramFiles\PostgreSQL\*\bin\pg_dump.exe" -ErrorAction SilentlyContinue |
    Sort-Object { [int]($_.Directory.Parent.Name -replace '\D', '') } -Descending |
    Select-Object -First 1
  if ($exe) { return $exe.FullName }
  return $null
}

function Test-Docker { cmd /c "docker info >nul 2>&1"; return ($LASTEXITCODE -eq 0) }

function Start-DockerSePreciso {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Nem pg_dump nem Docker encontrados. Instale as ferramentas do PostgreSQL 18 (pg_dump) ou o Docker Desktop."
  }
  if (Test-Docker) { return }
  $candidatos = @(
    (Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\Docker Desktop.exe")
  )
  $exe = $candidatos | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $exe) { throw "Docker instalado mas parado, e nao achei o Docker Desktop para abrir." }
  Log "Abrindo o Docker Desktop..."
  Start-Process $exe
  for ($i = 0; $i -lt 60; $i++) { if (Test-Docker) { return }; Start-Sleep -Seconds 3 }
  throw "O Docker nao subiu em 3 minutos."
}

$script:LogFile = $null
function Log([string]$Msg) {
  $linha = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Msg
  Write-Host $linha
  if ($script:LogFile) { Add-Content -LiteralPath $script:LogFile -Value $linha -Encoding UTF8 }
}

# Roda um executavel nativo mandando stdout+stderr para o log. Devolve o exit code.
function Invoke-Nativo([string]$Exe, [string[]]$Argumentos) {
  $anterior = $ErrorActionPreference
  $ErrorActionPreference = "Continue"   # no PS 5.1, stderr redirecionado com Stop vira excecao
  try {
    & $Exe @Argumentos 2>&1 | ForEach-Object { Log "  $_" }
    return $LASTEXITCODE
  } finally { $ErrorActionPreference = $anterior }
}

function Read-SenhaNova {
  for ($t = 0; $t -lt 3; $t++) {
    $a = Read-Host "Senha do backup (minimo 12 caracteres)" -AsSecureString
    $b = Read-Host "Repita a senha" -AsSecureString
    $ta = ConvertTo-Texto $a; $tb = ConvertTo-Texto $b
    if ($ta -ne $tb) { Write-Host "As senhas nao conferem." -ForegroundColor Yellow; continue }
    if ($ta.Length -lt 12) { Write-Host "Use pelo menos 12 caracteres." -ForegroundColor Yellow; continue }
    return $a
  }
  throw "Senha do backup nao definida."
}

# ---------------------------------------------------------------- -Configurar
if ($Configurar) {
  Write-Host "1) Cole a connection string de PRODUCAO do Neon (de preferencia a DIRECT_URL, sem -pooler)."
  $sec = Read-Host "postgresql://..." -AsSecureString
  $conn = ConvertTo-Conexao (ConvertTo-Texto $sec)
  Write-Host ""
  Write-Host "2) Escolha a SENHA DO BACKUP. Anote-a FORA deste PC (gerenciador de senhas, papel no cofre):" -ForegroundColor Yellow
  Write-Host "   sem ela nenhum backup pode ser aberto - nem por voce, nem em outro computador." -ForegroundColor Yellow
  $senha = Read-SenhaNova
  New-Item -ItemType Directory -Force -Path $CredDir | Out-Null
  $sec | Export-Clixml -LiteralPath $CredFile
  $senha | Export-Clixml -LiteralPath $SenhaFile
  Write-Host "OK - guardado. Host: $($conn.Host), banco: $($conn.Banco)." -ForegroundColor Green
  Write-Host "Teste agora com: .\scripts\backup-producao.ps1"
  exit 0
}

# ---------------------------------------------------------------- -Desagendar
if ($Desagendar) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Tarefa '$TaskName' removida."
  exit 0
}

# ---------------------------------------------------------------- -Decifrar
if ($Decifrar) {
  if (-not (Test-Path -LiteralPath $Decifrar)) { throw "Arquivo nao encontrado: $Decifrar" }
  $destinoDump = if ($Saida) { $Saida } else { $Decifrar -replace '\.cpbk$', '' }
  if ($destinoDump -eq $Decifrar) { $destinoDump = "$Decifrar.dump" }
  $senhaTexto = if (Test-Path -LiteralPath $SenhaFile) {
    ConvertTo-Texto (Import-Clixml -LiteralPath $SenhaFile)
  } else {
    ConvertTo-Texto (Read-Host "Senha do backup" -AsSecureString)
  }
  Unprotect-Arquivo $Decifrar $destinoDump $senhaTexto
  Write-Host "OK - $destinoDump" -ForegroundColor Green
  Write-Host "Esse .dump esta EM CLARO: apague-o depois de restaurar."
  exit 0
}

# ---------------------------------------------------------------- -Agendar
if ($Agendar) {
  if (-not (Test-Path -LiteralPath $CredFile) -or -not (Test-Path -LiteralPath $SenhaFile)) {
    throw "Rode primeiro: .\scripts\backup-producao.ps1 -Configurar"
  }
  [void](Get-PastaDestino)   # recusa OneDrive ja na hora de agendar
  $argumentos = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" -Manter $Manter -Destino `"$Destino`""
  $acao      = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argumentos
  $gatilho   = New-ScheduledTaskTrigger -Daily -DaysInterval 3 -At $Horario
  $config    = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable `
                 -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
                 -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew
  # Interactive = roda com o usuario logado, sem guardar senha do Windows (e o DPAPI precisa deste usuario).
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $TaskName -Action $acao -Trigger $gatilho -Settings $config -Principal $principal `
    -Description "pg_dump criptografado do banco de producao do CeasaPro (Neon) a cada 3 dias. Script: $PSCommandPath" -Force | Out-Null
  $prox = (Get-ScheduledTaskInfo -TaskName $TaskName).NextRunTime
  Write-Host "OK - tarefa '$TaskName' criada: a cada 3 dias as $Horario, em $Destino. Proxima: $prox" -ForegroundColor Green
  Write-Host "Se o PC estiver desligado na hora, roda assim que voce entrar no Windows."
  exit 0
}

# ---------------------------------------------------------------- backup
$pasta = Get-PastaDestino
$script:LogFile = Join-Path $pasta "backup.log"
$aviso = Join-Path $pasta "ATENCAO-ultimo-backup-falhou.txt"
$tmpDir = Join-Path $env:TEMP "ceasapro-backup"
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
$nome = "$Prefixo{0}.dump" -f (Get-Date -Format "yyyy-MM-dd_HHmm")
$tmpArq = Join-Path $tmpDir $nome
$tmpCifrado = "$tmpArq.cpbk"

try {
  if (-not (Test-Path -LiteralPath $CredFile) -or -not (Test-Path -LiteralPath $SenhaFile)) {
    throw "Backup nao configurado. Rode: .\scripts\backup-producao.ps1 -Configurar"
  }
  $conn = ConvertTo-Conexao (ConvertTo-Texto (Import-Clixml -LiteralPath $CredFile))
  $senhaBackup = ConvertTo-Texto (Import-Clixml -LiteralPath $SenhaFile)
  Log "Iniciando backup de $($conn.Banco) em $($conn.Host)"

  $env:PGPASSWORD = $conn.Senha
  $dumpArgs = @("--format=custom", "--compress=6", "--no-owner", "--no-privileges")
  $pgDump = Find-PgDump
  if ($pgDump) {
    Log "Usando $pgDump"
    $rc = Invoke-Nativo $pgDump ($dumpArgs + @("--file=$tmpArq", "--dbname=$($conn.Url)"))
    if ($rc -ne 0) { throw "pg_dump terminou com codigo $rc" }
    $pgRestore = Join-Path (Split-Path $pgDump) "pg_restore.exe"
    $lista = & $pgRestore --list $tmpArq 2>$null
  } else {
    Start-DockerSePreciso
    Log "Usando Docker ($PgImage)"
    $docker = @("run", "--rm", "-e", "PGPASSWORD", "-v", "${tmpDir}:/out", $PgImage)
    $rc = Invoke-Nativo "docker" ($docker + @("pg_dump") + $dumpArgs + @("--file=/out/$nome", "--dbname=$($conn.Url)"))
    if ($rc -ne 0) { throw "pg_dump (Docker) terminou com codigo $rc" }
    $lista = & docker run --rm -v "${tmpDir}:/out" $PgImage pg_restore --list "/out/$nome" 2>$null
  }

  # Confere que o arquivo abre e tem dados de tabela - dump vazio "com sucesso" e o pior backup.
  $tabelas = @($lista | Where-Object { $_ -match ' TABLE DATA ' }).Count
  if ($tabelas -eq 0) { throw "O dump foi gerado mas pg_restore --list nao achou dados de tabela." }

  # Criptografa no TEMP e confere que decifra antes de mover: backup que nao
  # abre so seria descoberto no dia em que fosse preciso.
  Protect-Arquivo $tmpArq $tmpCifrado $senhaBackup
  $conferencia = "$tmpArq.conferencia"
  Unprotect-Arquivo $tmpCifrado $conferencia $senhaBackup
  $iguais = (Get-FileHash -LiteralPath $tmpArq).Hash -eq (Get-FileHash -LiteralPath $conferencia).Hash
  Remove-Item -LiteralPath $conferencia -Force
  if (-not $iguais) { throw "O arquivo criptografado nao decifrou igual ao original." }

  $final = Join-Path $pasta "$nome.cpbk"
  Move-Item -LiteralPath $tmpCifrado -Destination $final -Force
  $mb = [math]::Round((Get-Item -LiteralPath $final).Length / 1MB, 2)
  Log "OK - $final ($mb MB, $tabelas tabelas com dados, criptografado)"

  # Retencao: mantem os $Manter mais recentes.
  Get-ChildItem -LiteralPath $pasta -Filter "$Prefixo*.dump.cpbk" | Sort-Object Name -Descending |
    Select-Object -Skip $Manter | ForEach-Object { Log "Removendo backup antigo $($_.Name)"; Remove-Item -LiteralPath $_.FullName -Force }

  if (Test-Path -LiteralPath $aviso) { Remove-Item -LiteralPath $aviso -Force }
  exit 0
}
catch {
  Log "FALHOU: $($_.Exception.Message)"
  # A tarefa roda escondida: o arquivo na pasta e o que avisa que algo deu errado.
  try {
    Set-Content -LiteralPath $aviso -Encoding UTF8 -Value @(
      "O backup do banco de producao do CeasaPro falhou em $(Get-Date -Format 'dd/MM/yyyy HH:mm').",
      "Motivo: $($_.Exception.Message)",
      "Detalhes em backup.log nesta pasta. Este arquivo some sozinho no proximo backup que der certo."
    )
  } catch { }
  exit 1
}
finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  # O dump EM CLARO nunca fica no disco.
  foreach ($f in @($tmpArq, $tmpCifrado, "$tmpArq.conferencia")) {
    if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue }
  }
}
