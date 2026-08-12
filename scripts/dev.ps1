<#
.SYNOPSIS
  One-command dev launcher for the Nanas' Kitchens monorepo (Windows/PowerShell).

.DESCRIPTION
  Handles the Windows-specific friction documented in CLAUDE.md:
    - Spring Boot does not read .env, so vars are exported into the process first.
      That same export also fixes the NestJS api crashing on a missing DATABASE_URL.
    - The root 'pnpm dev' script uses a single-quoted glob that cmd.exe takes
      literally, so each app is started with its own --filter instead.
    - mvnw spawns two java processes; a stale one holds :8080 on restart, so
      ports are cleared before launching.

  Each service gets its own window, so logs stay readable and Ctrl+C stops
  only that service.

.EXAMPLE
  .\scripts\dev.ps1                 # docker + migrate + java api + web + mcp
  .\scripts\dev.ps1 -Seed           # also run the seed script
  .\scripts\dev.ps1 -WithNest       # also start the legacy NestJS api (:3001)
  .\scripts\dev.ps1 -Install        # run pnpm install first
  .\scripts\dev.ps1 -Stop           # stop dev servers and docker containers
#>

[CmdletBinding()]
param(
    [switch]$Install,
    [switch]$Seed,
    [switch]$WithNest,
    [switch]$SkipMigrate,
    [switch]$Stop
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    $msg" -ForegroundColor Yellow }

# Ports each service listens on. Used both to clear stale servers and by -Stop.
$ServicePorts = @{ 'java-api' = 8080; 'web' = 3000; 'nest-api' = 3001; 'mcp' = 3002 }

function Stop-StaleListener($port, $label) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
        if (-not $proc) { continue }
        # Only ever kill dev runtimes - never something unrelated that happens to hold the port.
        if ($proc.ProcessName -notin @('java', 'node', 'pythonw')) {
            Write-Warn "Port $port is held by $($proc.ProcessName) (pid $($proc.Id)) - not a dev server, leaving it alone."
            continue
        }
        Write-Warn "Killing stale $label on :$port ($($proc.ProcessName), pid $($proc.Id))"
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
}

function Import-DotEnv($path) {
    if (-not (Test-Path $path)) {
        throw ".env not found at $path - copy .env.example to .env and fill it in."
    }
    $count = 0
    foreach ($line in Get-Content $path) {
        if ($line -match '^\s*#') { continue }
        if ($line -match '^\s*([^#=\s]+)\s*=\s*(.*)$') {
            $name = $Matches[1].Trim()
            $value = $Matches[2].Trim().Trim('"').Trim("'")
            [Environment]::SetEnvironmentVariable($name, $value, 'Process')
            $count++
        }
    }
    return $count
}

function Start-Service-Window($title, $workDir, $command) {
    # -NoExit keeps the window open so a crash stack stays readable.
    Start-Process powershell -ArgumentList @(
        '-NoExit', '-Command',
        "`$Host.UI.RawUI.WindowTitle = '$title'; Set-Location '$workDir'; $command"
    ) | Out-Null
    Write-Ok "$title started"
}

# ---------------------------------------------------------------- stop mode

if ($Stop) {
    Write-Step 'Stopping dev servers'
    foreach ($entry in $ServicePorts.GetEnumerator()) {
        Stop-StaleListener $entry.Value $entry.Key
    }
    Write-Step 'Stopping docker containers'
    Push-Location $RepoRoot
    try { docker compose down } finally { Pop-Location }
    Write-Ok 'Done.'
    return
}

# ---------------------------------------------------------------- prereqs

Write-Step 'Checking prerequisites'
foreach ($tool in @('pnpm', 'docker')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "$tool not found on PATH. See CLAUDE.md for setup."
    }
}
Write-Ok 'pnpm and docker found'

# ---------------------------------------------------------------- docker

function Test-DockerUp {
    # Do NOT redirect a native command's stderr in PowerShell (*> or 2>&1): 5.1 wraps each
    # stderr line in a NativeCommandError ErrorRecord, which the script-wide
    # $ErrorActionPreference = 'Stop' turns into a terminating error - firing on exactly the
    # "docker is down" path this check exists to handle. Let cmd.exe swallow the output so
    # only the exit code ever reaches PowerShell.
    cmd /c "docker info >nul 2>&1"
    return $LASTEXITCODE -eq 0
}

Write-Step 'Starting Docker (PostGIS + Redis)'
if (-not (Test-DockerUp)) {
    Write-Warn 'Docker daemon not responding - launching Docker Desktop...'
    $dockerDesktop = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
    if (Test-Path $dockerDesktop) { Start-Process $dockerDesktop }
    $waited = 0
    $dockerReady = $false
    while ($waited -lt 120) {
        Start-Sleep -Seconds 5
        $waited += 5
        if (Test-DockerUp) { $dockerReady = $true; break }
    }
    if (-not $dockerReady) { throw 'Docker did not become ready within 120s.' }
    Write-Ok "Docker ready after ${waited}s"
}

Push-Location $RepoRoot
try {
    docker compose up -d
    if ($LASTEXITCODE -ne 0) { throw 'docker compose up failed.' }

    # Postgres accepts TCP before it accepts queries; migrate would race without this.
    Write-Step 'Waiting for Postgres'
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        # Same NativeCommandError trap as Test-DockerUp: pg_isready writes to stderr while
        # the database is still starting, which is the normal case on this very line.
        cmd /c "docker compose exec -T db pg_isready -U culture >nul 2>&1"
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) { throw 'Postgres did not become ready.' }
    Write-Ok 'Postgres accepting connections'

    # ------------------------------------------------------------ env

    Write-Step 'Loading .env into the process environment'
    $loaded = Import-DotEnv (Join-Path $RepoRoot '.env')
    Write-Ok "$loaded variables exported (Spring + NestJS both inherit these)"

    # ------------------------------------------------------------ deps / schema

    if ($Install) {
        Write-Step 'Installing dependencies'
        pnpm install
        if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed.' }
    }

    if (-not $SkipMigrate) {
        # @prisma/client's postinstall cannot find the schema from the workspace root, so a
        # fresh clone gets a stub client with no model types and apps/api will not typecheck.
        # 'migrate deploy' does not generate one either. Same step CI needs (see ci.yml).
        Write-Step 'Generating Prisma client'
        pnpm --filter api prisma:generate
        if ($LASTEXITCODE -ne 0) { throw 'prisma generate failed.' }

        Write-Step 'Applying Prisma migrations'
        pnpm --filter api prisma:migrate:deploy
        if ($LASTEXITCODE -ne 0) { throw 'prisma migrate deploy failed.' }
        Write-Ok 'Schema up to date'
    }

    if ($Seed) {
        Write-Step 'Seeding demo data'
        pnpm --filter api seed
        if ($LASTEXITCODE -ne 0) { Write-Warn 'Seed failed - continuing anyway.' }
    }

    # ------------------------------------------------------------ services

    Write-Step 'Clearing stale dev servers'
    foreach ($entry in $ServicePorts.GetEnumerator()) {
        Stop-StaleListener $entry.Value $entry.Key
    }

    Write-Step 'Starting services'
    Start-Service-Window 'java-api :8080' (Join-Path $RepoRoot 'apps\api-java') '.\mvnw.cmd spring-boot:run'
    Start-Service-Window 'web :3000'      $RepoRoot 'pnpm --filter web dev'
    # mcp-server defaults to stdio (no port). Its dev:http script uses bash-style
    # 'TRANSPORT=http cmd', which cmd.exe/PowerShell do not understand, so set it here.
    Start-Service-Window 'mcp :3002'      $RepoRoot "`$env:TRANSPORT='http'; pnpm --filter mcp-server dev"
    if ($WithNest) {
        Start-Service-Window 'nest-api :3001' $RepoRoot 'pnpm --filter api dev'
    }

    Write-Host ''
    Write-Host '  web      http://localhost:3000' -ForegroundColor White
    Write-Host '  java api http://localhost:8080/health' -ForegroundColor White
    Write-Host '  mcp      http://localhost:3002' -ForegroundColor White
    if ($WithNest) { Write-Host '  nest api http://localhost:3001' -ForegroundColor White }
    Write-Host ''
    Write-Host '  login: buyer@demo.com / demo1234' -ForegroundColor DarkGray
    Write-Host '  stop:  .\scripts\dev.ps1 -Stop' -ForegroundColor DarkGray
    Write-Host ''
}
finally {
    Pop-Location
}
