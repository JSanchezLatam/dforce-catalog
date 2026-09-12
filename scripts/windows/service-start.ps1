<#
    The command the Windows scheduled task 'DforceCatalogo' runs. Nothing else
    should call it.

    Why this exists instead of pointing the task at standalone.ps1: that script
    runs migrations, builds, and prompts for a password. It is a setup script
    meant to be watched from a console, not a service entrypoint.

    This file's only job is to not start the app before its database exists.
    PostgreSQL is its own Windows service, so at boot both start at the same
    time, and losing that race is NOT a crash the supervisor can fix: measured
    on macOS in this same repo, `next start` against a refused Postgres keeps
    listening and answers every request with a 500, logging only
    "An error occurred while loading instrumentation hook" —
    src/instrumentation.ts registers the pg-boss workers at boot, and that is
    the half with no database. The supervisor sees a healthy process and leaves
    it there, serving 500s, forever.

    Supervision itself belongs to Task Scheduler (restart on failure), not to
    this script — there is deliberately no retry loop around the app below.

    ENCODING: saved as UTF-8 WITH a BOM so Windows PowerShell 5.1 parses the
    accented Spanish correctly. The log this script writes is UTF-8 WITHOUT a
    BOM, on purpose.
#>

[CmdletBinding()]
param(
    [int]    $Port          = 3000,
    # Baked in by install-service: SYSTEM's PATH is not the operator's, so a
    # Node resolved at install time is the only one guaranteed to be found.
    [string] $NodeDir       = '',
    [int]    $PgWaitSeconds = 60,
    [string] $PgHost        = '',
    [int]    $PgPort        = 0
)

$Root    = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$EnvFile = Join-Path $Root '.env'

# %LOCALAPPDATA% for whichever account the task runs as. As SYSTEM that is
# C:\Windows\System32\config\systemprofile\AppData\Local, which only an
# administrator can read — install-service prints the full path so nobody has
# to guess it.
$LogDir = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'dforce-catalog' }
          else { Join-Path $env:ProgramData 'dforce-catalog' }
$LogFile = Join-Path $LogDir 'service.log'

New-Item -ItemType Directory -Path $LogDir -Force -ErrorAction SilentlyContinue | Out-Null

# ponytail: one 10 MB roll, no rotation scheme. This machine reboots rarely and
# Next's stdout is quiet; if the log ever matters enough to keep history, use a
# real rotator.
$existing = Get-Item -LiteralPath $LogFile -ErrorAction SilentlyContinue
if ($existing -and $existing.Length -gt 10MB) {
    Move-Item -LiteralPath $LogFile -Destination "$LogFile.1" -Force -ErrorAction SilentlyContinue
}

$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Raw([string] $text) {
    try { [System.IO.File]::AppendAllText($LogFile, $text + "`r`n", $script:Utf8NoBom) }
    catch { }
    Write-Host $text
}

# Every line is timestamped and says what to do about itself, because this log
# is the only place anyone will ever read it from.
function Write-Log([string] $message) {
    Write-Raw ('[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message)
}

# --------------------------------------------------------------------------
# PATH and environment
# --------------------------------------------------------------------------
if ($NodeDir -and (Test-Path -LiteralPath $NodeDir)) {
    $env:Path = "$NodeDir;$env:Path"
}

# Same machine-wide Chromium cache standalone.ps1 installs into. SYSTEM's
# profile is not the operator's, so without this the catalog PDFs would be the
# one feature that fails and says nothing.
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $env:ProgramData 'ms-playwright'

# --------------------------------------------------------------------------
# Which Postgres to wait for
# --------------------------------------------------------------------------
# Read out of DATABASE_URL, never assumed to be 5432: this repo's .env
# legitimately points at 5433 on a machine that still has Docker, and waiting
# on 5432 there means waiting on a server the app is not going to use. Only the
# KEY=value shape is read, and no value is ever logged.
function Get-EnvValue([string] $path, [string] $key) {
    if (-not (Test-Path -LiteralPath $path)) { return '' }
    $value = ''
    foreach ($line in (Get-Content -LiteralPath $path)) {
        if ($line -match "^\s*$key\s*=\s*(.*?)\s*$") { $value = $Matches[1] }
    }
    return $value.Trim().Trim('"').Trim("'")
}

$dbUrl = Get-EnvValue $EnvFile 'DATABASE_URL'

$urlHost = ''
$urlPort = 0
if ($dbUrl) {
    $hostPort = $dbUrl -replace '^.*@', ''    # strip scheme and user:password@
    $hostPort = $hostPort -replace '[/?].*$', ''  # strip /database and ?params
    if ($hostPort -match '^(.*?):(\d+)$') {
        $urlHost = $Matches[1]
        $urlPort = [int]$Matches[2]
    }
    elseif ($hostPort) {
        $urlHost = $hostPort
    }
}

if (-not $PgHost) { $PgHost = if ($urlHost) { $urlHost } else { 'localhost' } }
if ($PgPort -le 0) { $PgPort = if ($urlPort -gt 0) { $urlPort } else { 5432 } }

# --------------------------------------------------------------------------
# pg_isready
# --------------------------------------------------------------------------
# The EDB installer does not put its bin directory on PATH, and SYSTEM's PATH
# is narrower still, so the executable is located rather than assumed.
function Resolve-PgIsReady {
    $cmd = Get-Command 'pg_isready.exe' -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if (-not $root) { continue }
        $pgRoot = Join-Path $root 'PostgreSQL'
        if (-not (Test-Path -LiteralPath $pgRoot)) { continue }
        $versions = Get-ChildItem -LiteralPath $pgRoot -Directory -ErrorAction SilentlyContinue |
                    Sort-Object Name -Descending
        foreach ($v in $versions) {
            $probe = Join-Path $v.FullName 'bin\pg_isready.exe'
            if (Test-Path -LiteralPath $probe) { return $probe }
        }
    }
    return ''
}

$pgIsReady = Resolve-PgIsReady

Write-Log '---'
Write-Log "Arrancando el servicio de Dforce Catálogo desde $Root."

if (-not $dbUrl) {
    Write-Log "No encontré DATABASE_URL en $EnvFile."
    Write-Log 'No arranco la app: sin base de datos contestaría 500 a todo sin decir por qué.'
    Write-Log '  Cómo arreglarlo:  copiá env.example a .env y corregí DATABASE_URL.'
    exit 1
}

if (-not $pgIsReady) {
    Write-Log 'No encontré pg_isready.exe, así que no puedo esperar a la base.'
    Write-Log 'Arranco igual, pero si la base no está, la app va a contestar 500 a todo.'
    Write-Log '  Cómo arreglarlo:  instalá PostgreSQL 17 (winget install PostgreSQL.PostgreSQL.17)'
}
else {
    Write-Log "Esperando a Postgres en ${PgHost}:${PgPort} (hasta ${PgWaitSeconds}s)."
    $waited = 0
    $ready = $false
    while (-not $ready) {
        & $pgIsReady -h $PgHost -p "$PgPort" -q 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }

        $waited++
        if ($waited -ge $PgWaitSeconds) {
            Write-Log "Postgres no aceptó conexiones en ${PgHost}:${PgPort} en ${PgWaitSeconds}s."
            Write-Log 'No arranco la app: arrancaría y contestaría 500 a todo sin decir por qué.'
            Write-Log '  Cómo arreglarlo:  Start-Service postgresql-x64-17'
            Write-Log "  (si DATABASE_URL apunta a $PgPort, el que tiene que estar arriba es ese)"
            exit 1
        }
        Start-Sleep -Seconds 1
    }
    Write-Log "Postgres responde en ${PgHost}:${PgPort}."
}

# --------------------------------------------------------------------------
# The app
# --------------------------------------------------------------------------
if (-not (Test-Path -LiteralPath $Root)) {
    Write-Log "No pude entrar a $Root — ¿se movió el repo?"
    exit 1
}
Set-Location -LiteralPath $Root

$npm = if ($NodeDir -and (Test-Path -LiteralPath (Join-Path $NodeDir 'npm.cmd'))) {
    Join-Path $NodeDir 'npm.cmd'
} else {
    'npm.cmd'
}

Write-Log "Arrancando la app en el puerto $Port."

# Everything Next prints on stdout and stderr goes to the same file, which is
# what makes this log the single place to look after a boot.
& $npm run start -- --port $Port 2>&1 | ForEach-Object { Write-Raw ("$_") }
$exitCode = $LASTEXITCODE

# The app is never supposed to exit. Task Scheduler only restarts a task that
# ENDS IN FAILURE, so a clean `exit 0` here would leave the workshop with no
# app and a task the console reports as "completed successfully". Reporting a
# clean exit as a failure is what makes the restart setting actually cover it.
if ($exitCode -eq 0) {
    Write-Log 'La app terminó con código 0, y no debería terminar nunca.'
    Write-Log 'Lo reporto como falla para que el Programador de tareas la reinicie.'
    exit 1
}

Write-Log "La app terminó con código $exitCode."
exit $exitCode
