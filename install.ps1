<#
.SYNOPSIS
  Persona.AI installer for Windows: install, update, backup, restore, uninstall, doctor, status.

.DESCRIPTION
  Docker mode (recommended) runs everything in Docker Desktop with the same compose file as
  Linux and macOS. Native mode installs Python (via uv) and the app under your user profile and
  starts it at logon with a scheduled task (or as a Windows service when NSSM is installed).

  Read this script before running it. It never prints secrets: they are generated with the
  system CSPRNG and written to a .env file that only your account can read.

  Run it from PowerShell:
    powershell -ExecutionPolicy Bypass -File .\install.ps1            # interactive
    .\install.ps1 -Docker -Yes                                         # scripted
    .\install.ps1 update | backup | restore <file> | uninstall [-Purge] | doctor | status

.EXAMPLE
  .\install.ps1 -Docker -Yes -Domain chat.example.com -Email you@example.com
.EXAMPLE
  $env:PERSONA_LLM_API_KEY = '...'; .\install.ps1 -Native -Yes -Llm external -LlmUrl https://openrouter.ai/api/v1
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('install', 'update', 'backup', 'restore', 'uninstall', 'doctor', 'status', 'help')]
  [string]$Command = 'install',
  [Parameter(Position = 1)] [string]$File,
  [switch]$Docker,
  [switch]$Native,
  [switch]$Yes,
  [string]$Dir,
  [string]$Domain,
  [string]$Email,
  [int]$Port = 8000,
  [switch]$Lan,
  [ValidateSet('', 'ollama', 'external', 'none')] [string]$Llm = '',
  [string]$LlmUrl,
  [string]$Model,
  [ValidateSet('auto', 'nvidia', 'none')] [string]$Gpu = 'auto',
  [switch]$Tts, [switch]$NoTts,
  [switch]$Stt, [switch]$NoStt,
  [switch]$Redis,
  [switch]$Seed, [switch]$NoSeed,
  [switch]$Purge,
  [string]$Out
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is 10x slower with the progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = if ($env:PERSONA_REPO) { $env:PERSONA_REPO } else { 'https://github.com/Cat-things/Persona.AI' }
$Branch = if ($env:PERSONA_BRANCH) { $env:PERSONA_BRANCH } else { 'main' }
$Raw = "https://raw.githubusercontent.com/Cat-things/Persona.AI/$Branch"
$ImageDefault = 'ghcr.io/cat-things/persona-server:latest'
$NodeVersion = '22.12.0'
$TaskName = 'Persona.AI'
$ServiceName = 'PersonaAI'
$StateFile = Join-Path $env:LOCALAPPDATA 'Persona\install.conf'
$ScriptDir = if ($PSCommandPath) { Split-Path -Parent $PSCommandPath } else { '' }

# ----------------------------------------------------------------------------- output
function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Info($m) { Write-Host "    $m" }
function Ok($m) { Write-Host "  ok $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  !! $m" -ForegroundColor Yellow }
function Die($m) { Write-Host "  xx $m" -ForegroundColor Red; exit 1 }

function Ask([string]$Question, [string]$Default) {
  if ($Yes) { return $Default }
  $r = Read-Host "$Question [$Default]"
  if ([string]::IsNullOrWhiteSpace($r)) { return $Default } else { return $r.Trim() }
}
function Confirm([string]$Question, [bool]$Default = $true) {
  if ($Yes) { return $Default }
  $d = if ($Default) { 'Y/n' } else { 'y/N' }
  $r = Read-Host "$Question [$d]"
  if ([string]::IsNullOrWhiteSpace($r)) { return $Default }
  return $r.Trim().ToLower().StartsWith('y')
}
# Dangerous actions: -Yes alone doesn't confirm them; the user must type the word.
function ConfirmDanger([string]$Question) {
  if ($Yes -and $env:PERSONA_FORCE -eq '1') { return $true }
  $r = Read-Host "$Question Type 'yes' to continue"
  return $r -eq 'yes'
}

function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
}

# ----------------------------------------------------------------------------- secrets / env
function New-Secret([int]$Bytes = 48) {
  $b = New-Object byte[] $Bytes
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($b) } finally { $rng.Dispose() }
  # URL-safe base64 without padding
  return [Convert]::ToBase64String($b).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

# Lock a file to the current user (and SYSTEM, for services). No one else can read it.
function Protect-File([string]$Path) {
  if (-not (Test-Path $Path)) { New-Item -ItemType File -Path $Path -Force | Out-Null }
  $me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  & icacls.exe $Path /inheritance:r /grant:r "${me}:(F)" '*S-1-5-18:(F)' | Out-Null
  if ($LASTEXITCODE -ne 0) { Warn "Couldn't restrict permissions on $Path" }
}

function Read-Env([string]$Path) {
  $map = [ordered]@{}
  if (Test-Path $Path) {
    foreach ($line in [IO.File]::ReadAllLines($Path)) {
      if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
      $i = $line.IndexOf('=')
      $map[$line.Substring(0, $i).Trim()] = $line.Substring($i + 1)
    }
  }
  return $map
}

function Write-Env([string]$Path, $Map) {
  $lines = foreach ($k in $Map.Keys) { "$k=$($Map[$k])" }
  # UTF-8 without BOM, LF endings: Docker's env_file parser and python-dotenv both accept it.
  [IO.File]::WriteAllText($Path, (($lines -join "`n") + "`n"), (New-Object Text.UTF8Encoding $false))
}

function Set-EnvValue($Map, [string]$Key, [string]$Value) { $Map[$Key] = $Value }
function Set-EnvDefault($Map, [string]$Key, [string]$Value) {
  if (-not $Map.Contains($Key) -or [string]::IsNullOrEmpty($Map[$Key])) { $Map[$Key] = $Value }
}

function Save-State($State) {
  New-Item -ItemType Directory -Force -Path (Split-Path $StateFile) | Out-Null
  ($State.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join "`n" |
    Set-Content -Path $StateFile -Encoding ascii
}
function Load-State {
  if (-not (Test-Path $StateFile)) { return $null }
  $s = @{}
  foreach ($l in Get-Content $StateFile) {
    if ($l -match '^(\w+)=(.*)$') { $s[$Matches[1]] = $Matches[2] }
  }
  return $s
}
function Require-Install {
  $s = Load-State
  if (-not $s) { Die "Persona.AI isn't installed for this user (no $StateFile)." }
  return $s
}

# ----------------------------------------------------------------------------- detection
function Detect-Hardware {
  $info = [ordered]@{ Gpu = 'none'; VramMB = 0; RamMB = 0; Arch = $env:PROCESSOR_ARCHITECTURE }
  $info.RamMB = [int]((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1MB)
  if ($Gpu -ne 'none' -and (Have 'nvidia-smi')) {
    try {
      $v = & nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>$null | Select-Object -First 1
      if ($v) { $info.Gpu = 'nvidia'; $info.VramMB = [int]$v.Trim() }
    } catch { }
  }
  if ($Gpu -eq 'nvidia' -and $info.Gpu -ne 'nvidia') { Warn 'No working NVIDIA driver found (nvidia-smi); continuing on CPU.' }
  return $info
}

# Official, safety-tuned instruct models (see docs/models.md); same table as install.sh.
function Recommend-Model($hw) {
  $mem = $hw.VramMB
  if ($mem -ge 20000) { return 'gemma3:27b' }
  if ($mem -ge 10000) { return 'gemma3:12b' }
  if ($mem -ge 6000 -or $hw.RamMB -ge 12000) { return 'llama3.1:8b' }
  return 'gemma3:4b'
}

# ----------------------------------------------------------------------------- downloads
function Get-File([string]$Url, [string]$Dest) {
  Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Dest
}
function Get-RepoFile([string]$Rel, [string]$Dest) {
  $local = if ($ScriptDir) { Join-Path $ScriptDir $Rel } else { '' }
  if ($local -and (Test-Path $local)) { Copy-Item $local $Dest -Force }
  else { Get-File "$Raw/$Rel" $Dest }
}
function Winget-Install([string]$Id, [string]$What) {
  if (-not (Have 'winget')) { Die "$What is needed and winget isn't available. Install $What manually, then re-run." }
  Info "Installing $What with winget"
  & winget install -e --id $Id --accept-package-agreements --accept-source-agreements --silent | Out-Null
  Refresh-Path
}

# ----------------------------------------------------------------------------- docker mode
# Runs `docker compose` in $Dir, shows its output, and returns only the exit code.
function Compose([string[]]$ComposeArgs, [string]$Dir) {
  Push-Location $Dir
  try { & docker compose @ComposeArgs | Out-Host; return $LASTEXITCODE } finally { Pop-Location }
}

function Ensure-Docker {
  if (Have 'docker') {
    & docker info *> $null
    if ($LASTEXITCODE -eq 0) { return }
    Die 'Docker is installed but not running. Start Docker Desktop, wait until it says "Engine running", then re-run.'
  }
  if (-not (Confirm 'Docker Desktop is not installed. Install it now with winget? (needs admin, may need a reboot)' $true)) {
    Die 'Docker Desktop is required for Docker mode. Or run with -Native.'
  }
  Winget-Install 'Docker.DockerDesktop' 'Docker Desktop'
  Die 'Docker Desktop was installed. Start it once (and reboot if Windows asks), then run this installer again.'
}

function Wait-Healthy([string]$Url) {
  Info 'Waiting for the server to come up...'
  for ($i = 0; $i -lt 90; $i++) {
    try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 $Url | Out-Null; Ok 'Server is up'; return $true } catch { Start-Sleep 2 }
  }
  Warn "The server didn't answer at $Url yet. Check the logs (see 'doctor')."
  return $false
}

function Install-Docker($cfg) {
  Ensure-Docker
  Step "Writing configuration to $($cfg.Dir)"
  New-Item -ItemType Directory -Force -Path $cfg.Dir, "$($cfg.Dir)\data", "$($cfg.Dir)\backups" | Out-Null
  foreach ($f in 'docker-compose.yml', 'docker-compose.nvidia.yml', 'docker-compose.amd.yml') {
    Get-RepoFile "deploy/$f" (Join-Path $cfg.Dir $f)
  }
  if ($cfg.Domain) {
    $caddy = ''
    if ($cfg.Email) { $caddy += "{`n`temail $($cfg.Email)`n}`n`n" }
    $caddy += "{`$DOMAIN} {`n`tencode zstd gzip`n`treverse_proxy persona:8000`n`theader Strict-Transport-Security `"max-age=31536000; includeSubDomains`"`n}`n"
    [IO.File]::WriteAllText((Join-Path $cfg.Dir 'Caddyfile'), $caddy)
    New-Item -ItemType Directory -Force -Path "$($cfg.Dir)\caddy\data", "$($cfg.Dir)\caddy\config" | Out-Null
  }

  $envPath = Join-Path $cfg.Dir '.env'
  Protect-File $envPath
  $e = Read-Env $envPath
  Write-CommonEnv $e $cfg
  Set-EnvValue $e EMBEDDED_WORKER 'false'
  $profiles = @('core')
  $files = @('docker-compose.yml')
  if ($cfg.Hw.Gpu -eq 'nvidia') { $files += 'docker-compose.nvidia.yml'; $profiles += 'gpu' }
  if ($cfg.Llm -eq 'ollama') { $profiles += 'llm'; Set-EnvValue $e LLM_BASE_URL 'http://ollama:11434/v1' }
  if ($cfg.Tts) {
    $profiles += 'tts'
    Set-EnvValue $e TTS_PROVIDER 'openai'
    Set-EnvValue $e TTS_BASE_URL 'http://kokoro:8880/v1'
    Set-EnvValue $e KOKORO_IMAGE ($(if ($cfg.Hw.Gpu -eq 'nvidia') { 'ghcr.io/remsky/kokoro-fastapi-gpu:latest' } else { 'ghcr.io/remsky/kokoro-fastapi-cpu:latest' }))
  }
  if ($cfg.Stt) {
    $profiles += 'stt'
    Set-EnvValue $e STT_PROVIDER 'openai'
    Set-EnvValue $e STT_BASE_URL 'http://stt:8000/v1'
    Set-EnvDefault $e STT_MODEL 'Systran/faster-whisper-small'
    Set-EnvValue $e STT_IMAGE ($(if ($cfg.Hw.Gpu -eq 'nvidia') { 'ghcr.io/speaches-ai/speaches:latest-cuda' } else { 'ghcr.io/speaches-ai/speaches:latest-cpu' }))
    New-Item -ItemType Directory -Force -Path "$($cfg.Dir)\stt-cache" | Out-Null
  }
  if ($cfg.Redis) { $profiles += 'redis'; Set-EnvValue $e REDIS_URL 'redis://redis:6379/0' }
  if ($cfg.Domain) {
    $profiles += 'proxy'
    Set-EnvValue $e DOMAIN $cfg.Domain
    Set-EnvValue $e ACME_EMAIL $cfg.Email
  }
  Set-EnvValue $e COMPOSE_PROFILES ($profiles -join ',')
  # Docker Compose on Windows separates COMPOSE_FILE entries with ';'.
  Set-EnvValue $e COMPOSE_PATH_SEPARATOR ';'
  Set-EnvValue $e COMPOSE_FILE ($files -join ';')
  Set-EnvValue $e PORT "$($cfg.Port)"
  Set-EnvValue $e BIND_ADDR ($(if ($cfg.Lan -and -not $cfg.Domain) { '0.0.0.0' } else { '127.0.0.1' }))
  Set-EnvDefault $e PERSONA_IMAGE $ImageDefault
  Write-Env $envPath $e
  Ok 'Wrote docker-compose files and .env (secrets stay in .env, readable only by you)'

  Step 'Starting containers'
  if ((Compose @('pull', '--quiet') $cfg.Dir) -ne 0) { Warn 'Some images could not be pulled; trying to start anyway.' }
  if ((Compose @('up', '-d', '--remove-orphans') $cfg.Dir) -ne 0) { Die 'docker compose up failed. See the output above.' }
  Wait-Healthy "http://127.0.0.1:$($cfg.Port)/api/v1/health" | Out-Null

  if ($cfg.Llm -eq 'ollama' -and $cfg.Model) {
    Step "Downloading model $($cfg.Model) (this can take a while)"
    if ((Compose @('exec', '-T', 'ollama', 'ollama', 'pull', $cfg.Model) $cfg.Dir) -ne 0) {
      Warn "Model download failed; retry with: cd `"$($cfg.Dir)`"; docker compose exec ollama ollama pull $($cfg.Model)"
    }
  }
  if ($cfg.Seed) {
    if ((Compose @('exec', '-T', 'persona', 'persona', 'seed-demo') $cfg.Dir) -eq 0) { Ok 'Sample characters added' }
  }
}

# ----------------------------------------------------------------------------- shared env
function Write-CommonEnv($e, $cfg) {
  Set-EnvDefault $e SECRET_KEY (New-Secret)
  Set-EnvDefault $e ENVIRONMENT 'production'
  Set-EnvValue $e PUBLIC_URL ($(if ($cfg.Domain) { "https://$($cfg.Domain)" } else { "http://localhost:$($cfg.Port)" }))
  if ($cfg.Domain) { Set-EnvValue $e CORS_ORIGINS "https://$($cfg.Domain)" }
  switch ($cfg.Llm) {
    'ollama' {
      Set-EnvValue $e LLM_PROVIDER 'openai'
      Set-EnvValue $e LLM_MODEL $cfg.Model
      Set-EnvDefault $e LLM_CONTEXT_TOKENS '8192'
    }
    'external' {
      Set-EnvValue $e LLM_PROVIDER ($(if ($cfg.LlmUrl -like '*anthropic.com*') { 'anthropic' } else { 'openai' }))
      Set-EnvValue $e LLM_BASE_URL $cfg.LlmUrl
      if ($cfg.Model) { Set-EnvValue $e LLM_MODEL $cfg.Model }
      if ($env:PERSONA_LLM_API_KEY) { Set-EnvValue $e LLM_API_KEY $env:PERSONA_LLM_API_KEY }
      Set-EnvDefault $e LLM_CONTEXT_TOKENS '16384'
    }
  }
}

# ----------------------------------------------------------------------------- native mode
function Ensure-Uv {
  if (Have 'uv') { return }
  Winget-Install 'astral-sh.uv' 'uv (Python toolchain manager)'
  if (-not (Have 'uv')) { Die 'uv was installed but is not on PATH yet. Open a new PowerShell window and re-run.' }
}

function Ensure-Node([string]$Dir) {
  $nodeDir = Join-Path $Dir '.node'
  if (Test-Path (Join-Path $nodeDir 'node.exe')) { return $nodeDir }
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  $name = "node-v$NodeVersion-win-$arch"
  $zip = Join-Path $env:TEMP "$name.zip"
  Info "Downloading Node.js $NodeVersion for the web build"
  Get-File "https://nodejs.org/dist/v$NodeVersion/$name.zip" $zip
  $sums = (Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt").Content
  $want = ($sums -split "`n" | Where-Object { $_ -match " $name\.zip$" } | Select-Object -First 1) -replace '\s.*$', ''
  $got = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLower()
  if (-not $want -or $got -ne $want.ToLower()) { Remove-Item $zip -Force; Die 'Node.js download failed its checksum check.' }
  Expand-Archive -Path $zip -DestinationPath $Dir -Force
  Move-Item (Join-Path $Dir $name) $nodeDir -Force
  Remove-Item $zip -Force
  return $nodeDir
}

function Get-Source([string]$App) {
  if ($ScriptDir -and (Test-Path (Join-Path $ScriptDir 'apps\server\pyproject.toml')) -and ($ScriptDir -ne $App)) {
    Info 'Copying the local checkout'
    if (Test-Path $App) { Remove-Item -Recurse -Force $App }
    New-Item -ItemType Directory -Force -Path $App | Out-Null
    $skip = @('node_modules', '.venv', 'data', 'dist', '.git', 'android', 'ios', 'test-results')
    Get-ChildItem -Force $ScriptDir | Where-Object { $skip -notcontains $_.Name } |
      Copy-Item -Destination $App -Recurse -Force
    # robocopy would be faster, but keeping to built-ins; prune nested build output
    Get-ChildItem -Path $App -Recurse -Directory -Force -Include node_modules, .venv |
      Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    return
  }
  $zip = Join-Path $env:TEMP 'persona-src.zip'
  Info "Downloading $Repo ($Branch)"
  Get-File "$Repo/archive/refs/heads/$Branch.zip" $zip
  $tmp = Join-Path $env:TEMP 'persona-src'
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $inner = Get-ChildItem $tmp | Select-Object -First 1
  if (Test-Path $App) { Remove-Item -Recurse -Force $App }
  Move-Item $inner.FullName $App
  Remove-Item -Recurse -Force $tmp, $zip
}

function Build-Native($cfg, [string]$App) {
  Step 'Building'
  $extras = @()
  if ($cfg.Tts) { $extras += '--extra', 'tts' }
  if ($cfg.Stt) { $extras += '--extra', 'stt' }
  Push-Location (Join-Path $App 'apps\server')
  try {
    $env:UV_PYTHON_INSTALL_DIR = Join-Path $cfg.Dir '.python'
    & uv sync -q --frozen --no-dev --python 3.12 @extras
    if ($LASTEXITCODE -ne 0) { Die 'Python dependencies failed to install.' }
  } finally { Pop-Location }
  Ok 'Python environment ready'
  $node = Ensure-Node $cfg.Dir
  Push-Location $App
  try {
    $env:Path = "$node;$env:Path"
    $env:COREPACK_HOME = Join-Path $node 'corepack'
    & (Join-Path $node 'corepack.cmd') enable --install-directory $node pnpm *> $null
    & (Join-Path $node 'pnpm.cmd') install --frozen-lockfile --filter '@persona/web...' --silent
    if ($LASTEXITCODE -ne 0) { Die 'Installing web dependencies failed.' }
    & (Join-Path $node 'pnpm.cmd') --filter '@persona/web' build *> $null
    if ($LASTEXITCODE -ne 0) { Die 'Building the web app failed.' }
  } finally { Pop-Location }
  Ok 'Web app built'
}

# Loads the env file into the process and runs `persona <args>` (used by the task/service too).
function Write-Launcher([string]$Dir, [string]$App, [string]$EnvPath) {
  $exe = Join-Path $App 'apps\server\.venv\Scripts\persona.exe'
  $launcher = @"
# Generated by install.ps1. Loads settings from the env file, then runs persona.
param([Parameter(ValueFromRemainingArguments = `$true)] [string[]]`$Rest)
foreach (`$line in [IO.File]::ReadAllLines('$EnvPath')) {
  if (`$line -match '^\s*#' -or `$line -notmatch '=') { continue }
  `$i = `$line.IndexOf('=')
  [Environment]::SetEnvironmentVariable(`$line.Substring(0, `$i).Trim(), `$line.Substring(`$i + 1), 'Process')
}
& '$exe' @Rest
exit `$LASTEXITCODE
"@
  $path = Join-Path $Dir 'persona.ps1'
  Set-Content -Path $path -Value $launcher -Encoding UTF8
  return $path
}

function Invoke-Persona($State, [string[]]$PersonaArgs) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $State.Dir 'persona.ps1') @PersonaArgs | Out-Host
  return $LASTEXITCODE
}

function Install-Ollama([string]$Model) {
  if (-not (Have 'ollama')) { Winget-Install 'Ollama.Ollama' 'Ollama' }
  if (-not (Have 'ollama')) { Warn "Ollama is installed but not on PATH yet; pull the model later with: ollama pull $Model"; return }
  if ($Model) {
    Step "Downloading model $Model (this can take a while)"
    & ollama pull $Model
    if ($LASTEXITCODE -ne 0) { Warn "Model download failed; retry with: ollama pull $Model" }
  }
}

function Register-Autostart([string]$Launcher, [string]$Dir) {
  $logs = Join-Path $Dir 'logs'
  New-Item -ItemType Directory -Force -Path $logs | Out-Null
  $nssm = Get-Command nssm -ErrorAction SilentlyContinue
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
  if ($nssm -and $admin) {
    Info 'Registering a Windows service with NSSM'
    & nssm stop $ServiceName *> $null
    & nssm remove $ServiceName confirm *> $null
    & nssm install $ServiceName powershell.exe "-NoProfile -ExecutionPolicy Bypass -File `"$Launcher`" serve" | Out-Null
    & nssm set $ServiceName AppDirectory $Dir | Out-Null
    & nssm set $ServiceName AppStdout (Join-Path $logs 'persona.log') | Out-Null
    & nssm set $ServiceName AppStderr (Join-Path $logs 'persona.log') | Out-Null
    & nssm set $ServiceName Start SERVICE_AUTO_START | Out-Null
    & nssm start $ServiceName | Out-Null
    return 'nssm'
  }
  Info "Registering scheduled task '$TaskName' (starts at logon)"
  $arg = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"& '$Launcher' serve *>> '$logs\persona.log'`""
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg -WorkingDirectory $Dir
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
    -Description 'Persona.AI server' | Out-Null
  Start-ScheduledTask -TaskName $TaskName
  return 'task'
}

function Stop-Native($State) {
  if ($State.Runner -eq 'nssm') { & nssm stop $ServiceName *> $null }
  else {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    # The task's PowerShell host exits but persona.exe may linger; stop it by path.
    $exe = Join-Path $State.Dir 'app\apps\server\.venv\Scripts\persona.exe'
    Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | Stop-Process -Force
  }
}
function Start-Native($State) {
  if ($State.Runner -eq 'nssm') { & nssm start $ServiceName *> $null } else { Start-ScheduledTask -TaskName $TaskName }
}

function Install-Native($cfg) {
  Ensure-Uv
  $app = Join-Path $cfg.Dir 'app'
  New-Item -ItemType Directory -Force -Path $cfg.Dir, "$($cfg.Dir)\data", "$($cfg.Dir)\backups" | Out-Null
  Step 'Getting the source'
  Get-Source $app
  Ok "Source at $app"
  Build-Native $cfg $app

  Step 'Configuration'
  $envPath = Join-Path $cfg.Dir 'persona.env'
  Protect-File $envPath
  $e = Read-Env $envPath
  Write-CommonEnv $e $cfg
  Set-EnvValue $e EMBEDDED_WORKER 'true'   # one process runs both the API and background jobs
  Set-EnvValue $e DATA_DIR (Join-Path $cfg.Dir 'data')
  Set-EnvValue $e WEB_DIST (Join-Path $app 'apps\web\dist')
  Set-EnvValue $e PORT "$($cfg.Port)"
  Set-EnvValue $e HOST ($(if ($cfg.Lan) { '0.0.0.0' } else { '127.0.0.1' }))
  if ($cfg.Llm -eq 'ollama') { Set-EnvValue $e LLM_BASE_URL 'http://127.0.0.1:11434/v1' }
  if ($cfg.Tts) { Set-EnvValue $e TTS_PROVIDER 'kokoro' } else { Set-EnvDefault $e TTS_PROVIDER 'none' }
  if ($cfg.Stt) {
    Set-EnvValue $e STT_PROVIDER 'faster-whisper'
    Set-EnvValue $e STT_DEVICE ($(if ($cfg.Hw.Gpu -eq 'nvidia') { 'cuda' } else { 'auto' }))
  } else { Set-EnvDefault $e STT_PROVIDER 'none' }
  Write-Env $envPath $e
  Ok "Settings in $envPath (secrets are never printed)"

  $launcher = Write-Launcher $cfg.Dir $app $envPath
  $state = @{ Dir = $cfg.Dir }
  Step 'Database'
  if ((Invoke-Persona $state @('migrate')) -ne 0) { Die 'Database migration failed.' }
  Ok 'Migrations applied'
  if ($cfg.Seed -and (Invoke-Persona $state @('seed-demo')) -eq 0) { Ok 'Sample characters added' }
  if ($cfg.Llm -eq 'ollama') { Install-Ollama $cfg.Model }

  Step 'Autostart'
  $runner = Register-Autostart $launcher $cfg.Dir
  Wait-Healthy "http://127.0.0.1:$($cfg.Port)/api/v1/health" | Out-Null
  return $runner
}

# ----------------------------------------------------------------------------- commands
function Cmd-Install {
  Write-Host "`nPersona.AI installer for Windows`n" -ForegroundColor White
  $hw = Detect-Hardware
  Info ("Hardware: {0}, {1} GB RAM{2}" -f $hw.Arch, [math]::Round($hw.RamMB / 1024), $(if ($hw.Gpu -eq 'nvidia') { ", NVIDIA GPU with $([math]::Round($hw.VramMB / 1024)) GB" } else { '' }))
  $prev = Load-State

  $mode = if ($Docker) { 'docker' } elseif ($Native) { 'native' } elseif ($prev) { $prev.Mode } else {
    if ((Ask 'Install mode: docker (recommended) or native' 'docker') -like 'n*') { 'native' } else { 'docker' }
  }
  $dir = if ($Dir) { $Dir } elseif ($prev) { $prev.Dir } else { Join-Path $env:LOCALAPPDATA 'Persona' }
  $domain = if ($Domain) { $Domain } elseif (-not $Yes) { Ask 'Public domain for HTTPS (leave empty for local only)' '' } else { '' }
  if ($domain -and $mode -eq 'native') {
    Warn 'Automatic HTTPS with a domain is set up in Docker mode only. Use -Docker, or put your own reverse proxy in front.'
    $domain = ''
  }
  $email = if ($Email) { $Email } elseif ($domain -and -not $Yes) { Ask 'Email for Let''s Encrypt notices (optional)' '' } else { '' }

  $llm = if ($Llm) { $Llm } else { Ask 'Chat model: ollama (local), external (OpenAI-compatible API) or none' 'ollama' }
  $model = $Model
  $llmUrl = $LlmUrl
  if ($llm -eq 'ollama' -and -not $model) { $model = Ask 'Model to download' (Recommend-Model $hw) }
  if ($llm -eq 'external') {
    if (-not $llmUrl) { $llmUrl = Ask 'OpenAI-compatible base URL' 'https://openrouter.ai/api/v1' }
    if (-not $env:PERSONA_LLM_API_KEY -and -not $Yes) {
      $sec = Read-Host 'API key (input hidden)' -AsSecureString
      $env:PERSONA_LLM_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
    }
    if (-not $model) { $model = Ask 'Model name' 'meta-llama/llama-3.1-70b-instruct' }
  }
  $tts = if ($Tts) { $true } elseif ($NoTts) { $false } else { Confirm 'Enable local voices (Kokoro text to speech)?' $true }
  $stt = if ($Stt) { $true } elseif ($NoStt) { $false } else { Confirm 'Enable local speech recognition for voice input and calls?' $true }
  $seed = if ($Seed) { $true } elseif ($NoSeed) { $false } else { Confirm 'Add a few sample characters?' $true }

  $cfg = [ordered]@{
    Mode = $mode; Dir = $dir; Domain = $domain; Email = $email; Port = $Port; Lan = [bool]$Lan
    Llm = $llm; LlmUrl = $llmUrl; Model = $model; Tts = $tts; Stt = $stt; Redis = [bool]$Redis
    Seed = $seed; Hw = $hw
  }
  $runner = ''
  if ($mode -eq 'docker') { Install-Docker $cfg } else { $runner = Install-Native $cfg }
  Remove-Item Env:\PERSONA_LLM_API_KEY -ErrorAction SilentlyContinue
  Save-State @{ Mode = $mode; Dir = $dir; Port = $Port; Runner = $runner }

  Step 'Done'
  $url = if ($domain) { "https://$domain" } else { "http://localhost:$Port" }
  Write-Host "`n  Open $url" -ForegroundColor Green
  Write-Host '  The first account you register becomes the admin.'
  if ($Lan -and -not $domain) {
    Write-Host "`n  Other devices on your network can use http://<this-PC's-IP>:$Port once the firewall allows it:"
    Write-Host "    New-NetFirewallRule -DisplayName 'Persona.AI' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private"
    Write-Host '  (run in an admin PowerShell; Private profile only, so public Wi-Fi stays closed)'
  }
  Write-Host "`n  Manage it with: .\install.ps1 update | backup | restore <file> | doctor | status | uninstall`n"
}

function Cmd-Update {
  $s = Require-Install
  Step 'Updating'
  if ($s.Mode -eq 'docker') {
    Compose @('pull', '--quiet') $s.Dir | Out-Null
    if ((Compose @('up', '-d', '--remove-orphans', '--force-recreate', 'persona', 'worker') $s.Dir) -ne 0) { Die 'Update failed.' }
    Compose @('up', '-d', '--remove-orphans') $s.Dir | Out-Null
  } else {
    $cfg = @{ Dir = $s.Dir; Tts = $false; Stt = $false }
    $e = Read-Env (Join-Path $s.Dir 'persona.env')
    $cfg.Tts = ($e['TTS_PROVIDER'] -eq 'kokoro')
    $cfg.Stt = ($e['STT_PROVIDER'] -eq 'faster-whisper')
    Stop-Native $s
    Get-Source (Join-Path $s.Dir 'app')
    Build-Native $cfg (Join-Path $s.Dir 'app')
    if ((Invoke-Persona $s @('migrate')) -ne 0) { Die 'Database migration failed.' }
    Start-Native $s
  }
  Wait-Healthy "http://127.0.0.1:$($s.Port)/api/v1/health" | Out-Null
  Ok 'Updated'
}

function Cmd-Backup {
  $s = Require-Install
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $dest = if ($Out) { $Out } else { Join-Path $s.Dir "backups\persona-$stamp.tar.gz" }
  New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
  Step 'Backup'
  if ($s.Mode -eq 'docker') {
    # Start-Process redirection is byte-exact; PowerShell's `>` would re-encode the archive.
    $p = Start-Process docker -ArgumentList 'compose', 'exec', '-T', 'persona', 'persona', 'backup', '--out', '-' `
      -WorkingDirectory $s.Dir -RedirectStandardOutput $dest -NoNewWindow -Wait -PassThru
    if ($p.ExitCode -ne 0) { Die 'Backup failed.' }
    Info 'The archive holds the database and media. Your .env (with secrets) is not included; back it up separately.'
  } else {
    if ((Invoke-Persona $s @('backup', '--out', $dest, '--env-file', (Join-Path $s.Dir 'persona.env'))) -ne 0) { Die 'Backup failed.' }
  }
  Protect-File $dest
  Ok "Wrote $dest (keep it private)"
}

function Cmd-Restore {
  $s = Require-Install
  if (-not $File -or -not (Test-Path $File)) { Die 'Usage: .\install.ps1 restore <backup.tar.gz>' }
  if (-not (ConfirmDanger "This replaces ALL current data with $File.")) { Die 'Cancelled.' }
  Step 'Restore'
  if ($s.Mode -eq 'docker') {
    Compose @('stop', 'persona', 'worker') $s.Dir | Out-Null
    $p = Start-Process docker -ArgumentList 'compose', 'run', '--rm', '-T', '--no-deps', 'persona', 'persona', 'restore', '-', '--yes' `
      -WorkingDirectory $s.Dir -RedirectStandardInput (Resolve-Path $File) -NoNewWindow -Wait -PassThru
    if ($p.ExitCode -ne 0) { Die 'Restore failed.' }
    Compose @('up', '-d') $s.Dir | Out-Null
  } else {
    Stop-Native $s
    if ((Invoke-Persona $s @('restore', (Resolve-Path $File).Path, '--yes')) -ne 0) { Die 'Restore failed.' }
    Start-Native $s
  }
  Wait-Healthy "http://127.0.0.1:$($s.Port)/api/v1/health" | Out-Null
  Ok 'Restored'
}

function Cmd-Uninstall {
  $s = Require-Install
  if (-not (Confirm 'Stop and remove Persona.AI services?' $false)) { Die 'Cancelled.' }
  Step 'Uninstall'
  if ($s.Mode -eq 'docker') { Compose @('down', '--remove-orphans') $s.Dir | Out-Null }
  else {
    Stop-Native $s
    if ($s.Runner -eq 'nssm') { & nssm remove $ServiceName confirm *> $null }
    else { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue }
  }
  if ($Purge) {
    if (ConfirmDanger "Delete $($s.Dir) including all chats, characters, media and backups?") {
      Remove-Item -Recurse -Force $s.Dir
      Ok 'Data deleted'
    } else { Info 'Kept your data.' }
  } else { Info "Your data is still in $($s.Dir). Add -Purge to delete it." }
  Remove-Item $StateFile -Force -ErrorAction SilentlyContinue
  Ok 'Uninstalled'
}

function Cmd-Status {
  $s = Require-Install
  Info "Mode: $($s.Mode)   Directory: $($s.Dir)   Port: $($s.Port)"
  if ($s.Mode -eq 'docker') { Compose @('ps') $s.Dir | Out-Null }
  elseif ($s.Runner -eq 'nssm') { & nssm status $ServiceName }
  else { Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Format-Table TaskName, State -AutoSize }
}

function Cmd-Doctor {
  $s = Require-Install
  Cmd-Status
  Step 'Checks'
  if ($s.Mode -eq 'docker') { Compose @('exec', '-T', 'persona', 'persona', 'doctor') $s.Dir | Out-Null }
  else { Invoke-Persona $s @('doctor') | Out-Null }
}

switch ($Command) {
  'install' { Cmd-Install }
  'update' { Cmd-Update }
  'backup' { Cmd-Backup }
  'restore' { Cmd-Restore }
  'uninstall' { Cmd-Uninstall }
  'status' { Cmd-Status }
  'doctor' { Cmd-Doctor }
  'help' { Get-Help $PSCommandPath -Detailed }
}
