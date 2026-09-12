<#
    Run the whole app on Windows WITHOUT Docker, against the PostgreSQL that
    the official EDB installer registers as a real Windows service.

    This is the port of scripts/standalone.sh. Everything the operator reads on
    screen is Spanish; every identifier and comment is English, per AGENTS.md.

    Every step checks its own state first, so a run that fails halfway is
    resumed by running the same command again. When something breaks it prints
    what is wrong and the exact command that fixes it, then exits non-zero.

    Usage (from the repo root, in PowerShell):
      powershell -ExecutionPolicy Bypass -File scripts\windows\standalone.ps1
      ... -SetupOnly                 database ready, app not started
      ... install-service            start the app at system boot (Task Scheduler)
      ... uninstall-service          remove that task and its firewall rule
      ... status                     what is running and what .env points at
      ... backup                     pg_dump -Fc into %USERPROFILE%\dforce-backups
      ... restore <archivo.dump>     restore a dump (asks first, backs up first)

    NOTE ON FILE ENCODING: this file is saved as UTF-8 WITH a BOM on purpose.
    Windows PowerShell 5.1 reads a BOM-less .ps1 as the ANSI codepage, which
    turns every accented Spanish character into mojibake. The BOM belongs on
    the SCRIPT; every file this script WRITES (the .env it patches, the service
    log) is written as UTF-8 WITHOUT a BOM, because a BOM there would corrupt
    the first key of .env and clutter the log.
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0)][string] $Command = '',
    [Parameter(Position = 1)][string] $Arg = '',

    [switch] $SetupOnly,

    [int]    $Port    = 3000,
    [string] $PgHost  = 'localhost',
    [int]    $PgPort  = 5432,

    [string] $DbName       = 'dforce_catalog',
    [string] $DbUser       = 'dforce',
    [string] $DbPassword   = 'dforce',
    [string] $SuperUser    = 'postgres',
    [string] $SuperPassword = '',

    [string] $SeedUser     = 'admin',
    [string] $SeedPassword = 'admin123',

    [string] $BackupDir = '',

    # Skip the destructive-restore confirmation (for a non-interactive shell).
    [switch] $Yes
)

# The compose file publishes 5433 to stay out of a local Postgres' way, which
# is why moving to a native server means rewriting exactly one line of .env.
$DockerPgPort = 5433

$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$EnvFile  = Join-Path $Root '.env'
$Wrapper  = Join-Path $PSScriptRoot 'service-start.ps1'
$TaskName = 'DforceCatalogo'
$FirewallRuleName = 'Dforce Catalogo (Next.js)'

if (-not $BackupDir) { $BackupDir = Join-Path $env:USERPROFILE 'dforce-backups' }

# Playwright resolves its Chromium out of a PER-USER cache, and the boot task
# runs as SYSTEM, whose profile is not the operator's. Pinning both the install
# and the run to one machine-wide directory is what stops catalog PDFs from
# being the one feature that breaks silently after install-service.
$PlaywrightPath = Join-Path $env:ProgramData 'ms-playwright'
$env:PLAYWRIGHT_BROWSERS_PATH = $PlaywrightPath

# Where service-start.ps1 logs when it runs as SYSTEM. Computed, not guessed at
# by the operator: SYSTEM's LOCALAPPDATA is under the systemprofile.
$SystemLogFile = Join-Path $env:SystemRoot 'System32\config\systemprofile\AppData\Local\dforce-catalog\service.log'

# --------------------------------------------------------------------------
# Output helpers — same shape as standalone.sh, ASCII markers on purpose.
# --------------------------------------------------------------------------
# The macOS script uses U+25B8 and U+2713. Neither exists in codepage 437 or
# 850, which is what a stock Windows console still runs, so they would print as
# garbage. Accented Spanish letters DO exist in both, so the prose is intact.

function Step([string] $m) { Write-Host ''; Write-Host ">> $m" -ForegroundColor Cyan }
function Ok  ([string] $m) { Write-Host "  [OK] $m" -ForegroundColor Green }
function Warn([string] $m) { Write-Host "  [!]  $m" -ForegroundColor Yellow }
function Note([string] $m) { Write-Host "       $m" -ForegroundColor DarkGray }

# Fail <what is wrong> <how to fix it>
function Fail([string] $what, [string] $how) {
    Write-Host ''
    Write-Host "[X] $what" -ForegroundColor Red
    Write-Host ''
    Write-Host '  Cómo arreglarlo:'
    Write-Host ''
    foreach ($line in ($how -split "`r?`n")) { Write-Host "    $line" }
    Write-Host ''
    exit 1
}

# --------------------------------------------------------------------------
# .env reading and writing
# --------------------------------------------------------------------------
# Reads only the KEY=value shape, and never echoes a value.
function Get-EnvValue([string] $path, [string] $key) {
    if (-not (Test-Path -LiteralPath $path)) { return '' }
    $value = ''
    foreach ($line in (Get-Content -LiteralPath $path)) {
        if ($line -match "^\s*$key\s*=\s*(.*?)\s*$") { $value = $Matches[1] }
    }
    return $value.Trim().Trim('"').Trim("'")
}

# UTF-8 with NO BOM. Out-File in PowerShell 5.1 writes UTF-16 by default and
# its `-Encoding utf8` writes a BOM, either of which makes .env unreadable to
# Node: the BOM would arrive glued to the first key name.
function Write-TextNoBom([string] $path, [string] $text) {
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($path, $text, $utf8NoBom)
}

# --------------------------------------------------------------------------
# PostgreSQL binaries and service
# --------------------------------------------------------------------------
# The EDB installer does not put its bin directory on PATH by default, so
# resolving it is what makes every pg_* call below hit the server this script
# just checked.
function Resolve-PgBin {
    $cmd = Get-Command 'pg_isready.exe' -ErrorAction SilentlyContinue
    if ($cmd) { return (Split-Path -Parent $cmd.Source) }

    foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if (-not $root) { continue }
        $pgRoot = Join-Path $root 'PostgreSQL'
        if (-not (Test-Path -LiteralPath $pgRoot)) { continue }
        $versions = Get-ChildItem -LiteralPath $pgRoot -Directory -ErrorAction SilentlyContinue |
                    Sort-Object Name -Descending
        foreach ($v in $versions) {
            $probe = Join-Path $v.FullName 'bin\pg_isready.exe'
            if (Test-Path -LiteralPath $probe) { return (Split-Path -Parent $probe) }
        }
    }
    return ''
}

$script:PgBin = ''
function PgExe([string] $name) { return (Join-Path $script:PgBin $name) }

function Test-PgUp {
    if (-not $script:PgBin) { return $false }
    & (PgExe 'pg_isready.exe') -h $PgHost -p $PgPort -q 2>&1 | Out-Null
    return ($LASTEXITCODE -eq 0)
}

# Never assigns to $env:PGPASSWORD permanently, and never prints a value.
function Invoke-Psql {
    param(
        [string] $User,
        [string] $Password,
        [string] $Database,
        [string] $Query,
        [switch] $Tuples
    )
    $previous = $env:PGPASSWORD
    $env:PGPASSWORD = $Password
    try {
        $psqlArgs = @('-h', $PgHost, '-p', "$PgPort", '-U', $User, '-d', $Database)
        if ($Tuples) { $psqlArgs += @('-tAc', $Query) } else { $psqlArgs += @('-c', $Query) }
        $out = & (PgExe 'psql.exe') @psqlArgs 2>&1
        return [pscustomobject]@{
            Code = $LASTEXITCODE
            Out  = (($out | ForEach-Object { "$_" }) -join "`n").Trim()
        }
    }
    finally { $env:PGPASSWORD = $previous }
}

# The superuser password is asked for once, because Windows has no equivalent
# of the Homebrew cluster's "your OS user is already a superuser": the EDB
# installer creates 'postgres' with a password and pg_hba defaults to
# scram-sha-256 for host connections.
$script:SuperPass = $null
function Get-SuperPassword {
    if ($null -ne $script:SuperPass) { return $script:SuperPass }
    if ($SuperPassword) { $script:SuperPass = $SuperPassword; return $script:SuperPass }
    if ($env:PGPASSWORD) { $script:SuperPass = $env:PGPASSWORD; return $script:SuperPass }

    if (-not [Environment]::UserInteractive) {
        Fail "Necesito la clave del superusuario '$SuperUser' de PostgreSQL y no hay terminal para pedirla." @'
Pasala por parámetro:

  .\scripts\windows\standalone.ps1 -SuperPassword <clave>

O por variable de entorno:

  $env:PGPASSWORD = "<clave>"
'@
    }

    $secure = Read-Host -Prompt "  Clave del superusuario '$SuperUser' de PostgreSQL" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try   { $script:SuperPass = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    return $script:SuperPass
}

function Start-PostgresService {
    Step 'PostgreSQL como servicio de Windows'

    $script:PgBin = Resolve-PgBin
    $service = Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | Select-Object -First 1

    if (-not $service) {
        Fail 'No encontré ningún servicio de PostgreSQL en esta máquina.' @'
Instalá PostgreSQL 17 con el instalador oficial de EDB, que registra el
servicio de Windows y deja los ejecutables en Archivos de programa:

  winget install PostgreSQL.PostgreSQL.17

(o bajalo de https://www.postgresql.org/download/windows/)

Anotá la clave del superusuario "postgres" que te pide: este script la
necesita para crear el rol y la base.

Después:

  powershell -ExecutionPolicy Bypass -File scripts\windows\standalone.ps1
'@
    }

    if ($service.Name -notlike '*17*') {
        Warn "El servicio encontrado es '$($service.Name)', no uno de PostgreSQL 17."
        Note 'El contenedor de compose usa postgres:17; un pg_restore de un dump de 17'
        Note 'en un servidor menor va a fallar. Sigo igual porque la app funciona.'
    }

    if ($service.Status -ne 'Running') {
        Warn "El servicio '$($service.Name)' está en estado $($service.Status) — arrancándolo."
        Start-Service -Name $service.Name -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
        $service = Get-Service -Name $service.Name
        if ($service.Status -ne 'Running') {
            Fail "No pude arrancar el servicio '$($service.Name)'." @"
Probalo a mano desde una consola de administrador para ver el error completo:

  Start-Service $($service.Name)

Y mirá el log del servidor (la carpeta 'log' dentro del directorio de datos):

  Get-Content "`$env:ProgramFiles\PostgreSQL\17\data\log\*.log" -Tail 50
"@
        }
    }
    Ok "Servicio '$($service.Name)' corriendo"

    if (-not $script:PgBin) {
        Fail 'El servicio de PostgreSQL está arriba pero no encontré pg_isready.exe, así que no puedo verificar que acepte conexiones.' @'
Normalmente está en:

  C:\Program Files\PostgreSQL\17\bin

Agregá esa carpeta al PATH del sistema (Configuración -> Variables de entorno)
y volvé a correr el script.
'@
    }
    Note "binarios de Postgres: $($script:PgBin)"

    Write-Host -NoNewline '  esperando a que Postgres acepte conexiones'
    $waited = 0
    while (-not (Test-PgUp)) {
        $waited++
        if ($waited -ge 30) {
            Write-Host ''
            Fail "Postgres no aceptó conexiones en ${PgHost}:${PgPort} en 30s." @"
Si el servidor escucha en otro puerto, pasáselo:

  .\scripts\windows\standalone.ps1 -PgPort <puerto>

El puerto real está en postgresql.conf, dentro del directorio de datos:

  Select-String -Path "`$env:ProgramFiles\PostgreSQL\17\data\postgresql.conf" -Pattern '^port'

Y el motivo real de un servidor que arranca y no escucha siempre está en su log:

  Get-Content "`$env:ProgramFiles\PostgreSQL\17\data\log\*.log" -Tail 50
"@
        }
        Write-Host -NoNewline '.'
        Start-Sleep -Seconds 1
    }
    Write-Host ''
    Ok "Aceptando conexiones en ${PgHost}:${PgPort}"
}

# --------------------------------------------------------------------------
# Role and database
# --------------------------------------------------------------------------
function Initialize-RoleAndDatabase {
    Step 'Rol y base de datos'

    $pass = Get-SuperPassword
    $check = Invoke-Psql -User $SuperUser -Password $pass -Database 'postgres' -Query 'select 1' -Tuples
    if ($check.Out -ne '1') {
        Fail "Postgres está arriba pero no me deja conectar como '$SuperUser'. Dijo:

$($check.Out)" @"
Si la clave es otra, pasámela:

  .\scripts\windows\standalone.ps1 -SuperPassword <clave>

Si perdiste la clave del superusuario, se resetea editando pg_hba.conf a
'trust', reiniciando el servicio y corriendo ALTER USER. El archivo está en el
directorio de datos:

  `$env:ProgramFiles\PostgreSQL\17\data\pg_hba.conf
"@
    }

    $roleExists = Invoke-Psql -User $SuperUser -Password $pass -Database 'postgres' `
        -Query "select 1 from pg_roles where rolname='$DbUser'" -Tuples
    if ($roleExists.Out -eq '1') {
        Ok "Rol '$DbUser' ya existe"
    }
    else {
        $create = Invoke-Psql -User $SuperUser -Password $pass -Database 'postgres' `
            -Query "create role ""$DbUser"" login password '$DbPassword';"
        if ($create.Code -ne 0) {
            Fail "No pude crear el rol '$DbUser'. Salida completa:

$($create.Out)" @"
Creálo a mano y volvé a correr el script:

  & "$($script:PgBin)\psql.exe" -h $PgHost -p $PgPort -U $SuperUser -d postgres ``
    -c "create role $DbUser login password '$DbPassword';"
"@
        }
        Ok "Rol '$DbUser' creado"
    }

    $dbExists = Invoke-Psql -User $SuperUser -Password $pass -Database 'postgres' `
        -Query "select 1 from pg_database where datname='$DbName'" -Tuples
    if ($dbExists.Out -eq '1') {
        Ok "Base '$DbName' ya existe"
    }
    else {
        $previous = $env:PGPASSWORD
        $env:PGPASSWORD = $pass
        try {
            $out = & (PgExe 'createdb.exe') -h $PgHost -p "$PgPort" -U $SuperUser -O $DbUser $DbName 2>&1
            $code = $LASTEXITCODE
        }
        finally { $env:PGPASSWORD = $previous }
        if ($code -ne 0) {
            Fail "No pude crear la base '$DbName'. Salida completa:

$(($out | ForEach-Object { "$_" }) -join "`n")" @"
  & "$($script:PgBin)\createdb.exe" -h $PgHost -p $PgPort -U $SuperUser -O $DbUser $DbName
"@
        }
        Ok "Base '$DbName' creada"
    }
}

# Number of user tables already in the target database. Empty string when the
# database or the role cannot be reached at all.
function Get-TableCount {
    $r = Invoke-Psql -User $DbUser -Password $DbPassword -Database $DbName `
        -Query "select count(*) from information_schema.tables where table_schema='public'" -Tuples
    if ($r.Code -ne 0) { return '' }
    return $r.Out
}

# --------------------------------------------------------------------------
# .env
# --------------------------------------------------------------------------
function Initialize-EnvFile {
    Step 'Archivo .env'

    if (-not (Test-Path -LiteralPath $EnvFile)) {
        $example = Join-Path $Root 'env.example'
        if (-not (Test-Path -LiteralPath $example)) {
            Fail 'No hay .env ni env.example, así que no puedo armar la configuración.' @'
Recuperá env.example del repo:

  git checkout -- env.example
'@
        }
        Copy-Item -LiteralPath $example -Destination $EnvFile
        Ok '.env creado a partir de env.example'
        Warn 'Los secretos de env.example son de mentira: IFX_TOKEN y las claves de R2'
        Note 'hay que corregirlos a mano o la sincronización de inventario y la subida'
        Note 'de catálogos van a fallar. La app arranca igual.'
    }

    $dbUrl = Get-EnvValue $EnvFile 'DATABASE_URL'
    if (-not $dbUrl) {
        Fail 'DATABASE_URL no está definida en .env.' @"
Agregala:

  DATABASE_URL=postgres://${DbUser}:${DbPassword}@${PgHost}:${PgPort}/${DbName}
"@
    }

    if ($dbUrl -match ":$PgPort/") {
        Ok "DATABASE_URL ya apunta a ${PgHost}:${PgPort}"
    }
    elseif ($dbUrl -match ":$DockerPgPort/") {
        $backup = Join-Path $Root (".env.bak-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
        Copy-Item -LiteralPath $EnvFile -Destination $backup -ErrorAction SilentlyContinue
        if (-not (Test-Path -LiteralPath $backup)) {
            Fail 'No pude respaldar .env antes de editarlo, así que no lo edité.' @"
Revisá permisos en $Root y reintentá.
"@
        }
        # Only the port inside DATABASE_URL is touched; every other line
        # (tokens, claves de R2) queda byte por byte igual.
        $text = Get-Content -LiteralPath $EnvFile -Raw
        $text = [regex]::Replace(
            $text,
            "(?m)^(\s*DATABASE_URL\s*=.*):$DockerPgPort/",
            "`${1}:$PgPort/")
        Write-TextNoBom $EnvFile $text

        $dbUrl = Get-EnvValue $EnvFile 'DATABASE_URL'
        if ($dbUrl -notmatch ":$PgPort/") {
            Fail 'Intenté cambiar el puerto en .env y no quedó aplicado.' @"
Editalo a mano (tu .env original está en $(Split-Path -Leaf $backup)):

  DATABASE_URL=postgres://${DbUser}:${DbPassword}@${PgHost}:${PgPort}/${DbName}
"@
        }
        Ok "DATABASE_URL movida de $DockerPgPort a $PgPort"
        Note "respaldo del .env anterior: $(Split-Path -Leaf $backup)"
    }
    else {
        Fail "DATABASE_URL no apunta ni a $PgPort ni a $DockerPgPort, así que no adivino qué querías. No la toqué." @"
Si querés el Postgres nativo de esta máquina, dejala así:

  DATABASE_URL=postgres://${DbUser}:${DbPassword}@${PgHost}:${PgPort}/${DbName}

Si el servidor escucha en otro puerto, decímelo y la dejo en paz:

  .\scripts\windows\standalone.ps1 -PgPort <puerto>
"@
    }

    $script:DatabaseUrl = $dbUrl
}

# --------------------------------------------------------------------------
# Migrations + first user
# --------------------------------------------------------------------------
function Invoke-Migrations {
    Step 'Migraciones de Drizzle'

    if (-not (Test-Path -LiteralPath (Join-Path $Root 'node_modules'))) {
        Fail 'node_modules no existe — el proyecto no tiene sus dependencias.' 'npm.cmd ci'
    }

    # scripts/migrate.mjs reads process.env directly and does NOT load .env —
    # only Next.js does. Setting it here is what makes this work at all.
    $previous = $env:DATABASE_URL
    $env:DATABASE_URL = $script:DatabaseUrl
    try {
        Push-Location $Root
        $out = & npm.cmd run --silent db:migrate 2>&1
        $code = $LASTEXITCODE
        Pop-Location
    }
    finally { $env:DATABASE_URL = $previous }

    if ($code -ne 0) {
        Fail "Las migraciones fallaron. Salida completa:

$(($out | ForEach-Object { "$_" }) -join "`n")" @"
Si el error es 'relation already exists', la base ya tenía el esquema pero
drizzle no lo registró. Mirá qué migraciones cree que corrió:

  & "$($script:PgBin)\psql.exe" -h $PgHost -p $PgPort -U $DbUser -d $DbName ``
    -c "select id, created_at from drizzle.__drizzle_migrations order by id;"

Compará contra src\shared\db\migrations\meta\_journal.json. La tabla que manda
es drizzle.__drizzle_migrations — NO public.__drizzle_migrations.
"@
    }
    Ok 'Base de datos al día'
}

function Initialize-FirstUser {
    Step 'Usuario inicial'

    $r = Invoke-Psql -User $DbUser -Password $DbPassword -Database $DbName -Query 'select count(*) from users;' -Tuples
    if ($r.Code -ne 0) {
        Warn 'No pude contar los usuarios; sigo sin sembrar ninguno.'
        Note $r.Out
        return
    }

    if ($r.Out -ne '0') {
        Ok "$($r.Out) usuario(s) en la base"
        return
    }

    Warn 'La tabla users está vacía — creando el usuario inicial.'
    $previous = $env:DATABASE_URL
    $env:DATABASE_URL = $script:DatabaseUrl
    try {
        Push-Location $Root
        # scripts\seed-user.mjs is cross-platform Node and lives at scripts\,
        # not under scripts\windows\.
        $out = & node (Join-Path $Root 'scripts\seed-user.mjs') $SeedUser $SeedPassword 'administrador' 2>&1
        $code = $LASTEXITCODE
        Pop-Location
    }
    finally { $env:DATABASE_URL = $previous }

    if ($code -ne 0) {
        Fail "No pude crear el usuario inicial. Salida completa:

$(($out | ForEach-Object { "$_" }) -join "`n")" @"
Creá uno a mano:

  `$env:DATABASE_URL = "<la de tu .env>"
  node scripts\seed-user.mjs <usuario> <clave> administrador
"@
    }
    Ok "Usuario '$SeedUser' creado con rol administrador"
    if ($SeedPassword -eq 'admin123') { Note 'clave: admin123 — cambiala desde Mi cuenta' }
}

# --------------------------------------------------------------------------
# Chromium for the catalog PDFs
# --------------------------------------------------------------------------
# src/modules/pdf-generation/worker.ts calls chromium.launch() with no
# executablePath, so Playwright resolves the binary out of a cache directory.
# This is the one feature that breaks SILENTLY when the binary is missing:
# everything else works and only the catalog job fails.
function Initialize-PlaywrightChromium {
    Step 'Chromium de Playwright'

    $found = $false
    if (Test-Path -LiteralPath $PlaywrightPath) {
        $found = [bool](Get-ChildItem -LiteralPath $PlaywrightPath -Directory -Filter 'chromium-*' -ErrorAction SilentlyContinue)
    }

    if ($found) {
        Ok 'Ya está descargado — no bajo nada'
    }
    else {
        Note 'los PDFs del catálogo se arman con Chromium headless; hay que bajarlo'
        Note 'una vez (~150 MB)'
        Push-Location $Root
        $out = & npx.cmd --yes playwright install chromium 2>&1
        $code = $LASTEXITCODE
        Pop-Location
        if ($code -ne 0) {
            Fail "No pude instalar Chromium, así que los PDFs del catálogo no van a generarse. Salida completa:

$(($out | ForEach-Object { "$_" }) -join "`n")" @"
Probalo a mano para ver el error completo (normalmente es red o proxy):

  `$env:PLAYWRIGHT_BROWSERS_PATH = "$PlaywrightPath"
  npx.cmd playwright install chromium

El resto de la app funciona sin esto: lo único que falla es generar catálogos.
"@
        }
        Ok 'Chromium instalado'
    }

    Note "caché: $PlaywrightPath"
    Note 'está en ProgramData y no en tu perfil a propósito: el servicio de arranque'
    Note 'corre como SYSTEM y no vería una caché guardada en tu carpeta de usuario'
}

# --------------------------------------------------------------------------
# Small Windows helpers
# --------------------------------------------------------------------------
function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-PortListener([int] $p) {
    return (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
}

# The address the other machines in the workshop have to type. `next start`
# binds 0.0.0.0 (Next 16's default hostname), so LAN access needs no flag — the
# only thing missing was anybody being told the URL. Returns '' when there is
# no address, because a blank or guessed URL is worse than saying there is none.
function Get-LanIPv4 {
    $config = Get-NetIPConfiguration -ErrorAction SilentlyContinue |
              Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
              Select-Object -First 1
    if ($config -and $config.IPv4Address) { return $config.IPv4Address[0].IPAddress }
    return ''
}

# Any HTTP status at all proves the server answered. Which status it is belongs
# to the app (the root redirects to /login), not to Task Scheduler.
function Test-AppAnswers([int] $p) {
    try {
        Invoke-WebRequest -Uri "http://127.0.0.1:$p/" -UseBasicParsing -TimeoutSec 3 | Out-Null
        return $true
    }
    catch {
        # A 4xx/5xx is still an answer; only "nothing listening" is not.
        return ($null -ne $_.Exception.Response)
    }
}

function Resolve-NodeDir {
    $node = Get-Command 'node.exe' -ErrorAction SilentlyContinue
    if (-not $node) { $node = Get-Command 'node' -ErrorAction SilentlyContinue }
    if (-not $node) { return '' }
    return (Split-Path -Parent $node.Source)
}

# --------------------------------------------------------------------------
# backup / restore
# --------------------------------------------------------------------------
function Invoke-Backup {
    $script:PgBin = Resolve-PgBin
    if (-not $script:PgBin) {
        Fail 'No encontré los binarios de PostgreSQL, así que no puedo hacer el backup.' @'
Agregá C:\Program Files\PostgreSQL\17\bin al PATH del sistema y reintentá.
'@
    }
    if (-not (Test-PgUp)) {
        Fail 'Postgres no está corriendo, así que no hay de dónde sacar el backup.' @'
Arrancá el servicio desde una consola de administrador:

  Start-Service postgresql-x64-17
'@
    }

    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
    $out = Join-Path $BackupDir ("$DbName-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.dump')

    $previous = $env:PGPASSWORD
    $env:PGPASSWORD = $DbPassword
    try {
        $dumpOut = & (PgExe 'pg_dump.exe') -h $PgHost -p "$PgPort" -U $DbUser -Fc $DbName -f $out 2>&1
        $code = $LASTEXITCODE
    }
    finally { $env:PGPASSWORD = $previous }

    if ($code -ne 0) {
        Remove-Item -LiteralPath $out -ErrorAction SilentlyContinue
        Fail "pg_dump falló. Salida completa:

$(($dumpOut | ForEach-Object { "$_" }) -join "`n")" @"
Verificá que la base exista y que el rol pueda leerla:

  & "$($script:PgBin)\psql.exe" -h $PgHost -p $PgPort -U $DbUser -d $DbName -c "\dt"
"@
    }

    $item = Get-Item -LiteralPath $out -ErrorAction SilentlyContinue
    if (-not $item -or $item.Length -eq 0) {
        Remove-Item -LiteralPath $out -ErrorAction SilentlyContinue
        Fail 'El backup salió vacío — lo borré para que no parezca un respaldo válido.' @"
Verificá que la base tenga datos:

  & "$($script:PgBin)\psql.exe" -h $PgHost -p $PgPort -U $DbUser -d $DbName -c "\dt"
"@
    }

    Ok ("Backup: $out ({0:N1} MB)" -f ($item.Length / 1MB))
    Note "restaurarlo: .\scripts\windows\standalone.ps1 restore `"$out`""
}

function Invoke-Restore([string] $file) {
    if (-not $file) {
        Fail 'No me pasaste qué archivo restaurar.' @"
  .\scripts\windows\standalone.ps1 restore <archivo.dump>

Los backups viven en ${BackupDir}:

  Get-ChildItem "$BackupDir"
"@
    }
    if (-not (Test-Path -LiteralPath $file)) {
        Fail "No existe el archivo '$file'." "Get-ChildItem `"$BackupDir`""
    }

    $script:PgBin = Resolve-PgBin
    if (-not $script:PgBin -or -not (Test-PgUp)) {
        Fail 'Postgres no está corriendo, no hay dónde restaurar.' @'
  Start-Service postgresql-x64-17
'@
    }

    Initialize-RoleAndDatabase

    # A restore overwrites live data, so the current state is dumped first. This
    # is the difference between a bad restore being an inconvenience and being
    # the incident.
    $count = Get-TableCount
    if ($count -and $count -ne '0') {
        Warn "La base '$DbName' tiene $count tabla(s) y la restauración las reemplaza."
        if (-not $Yes) {
            if (-not [Environment]::UserInteractive) {
                Fail 'Restauración destructiva sin terminal para confirmar.' @"
Corrélo desde una terminal, o asumí el riesgo explícitamente:

  .\scripts\windows\standalone.ps1 restore "$file" -Yes
"@
            }
            $answer = Read-Host -Prompt "`n  Escribí si para continuar"
            if ($answer -ne 'si') {
                Fail 'Cancelado — no toqué nada.' "Si querés seguir, escribí exactamente 'si' cuando pregunte."
            }
        }
        Step 'Respaldo previo por las dudas'
        Invoke-Backup
    }

    Step 'Restaurando'
    $previous = $env:PGPASSWORD
    $env:PGPASSWORD = $DbPassword
    try {
        # --clean --if-exists so a restore over an existing schema replaces it
        # instead of colliding object by object.
        $out = & (PgExe 'pg_restore.exe') -h $PgHost -p "$PgPort" -U $DbUser -d $DbName `
                 '--clean' '--if-exists' '--no-owner' $file 2>&1
    }
    finally { $env:PGPASSWORD = $previous }

    # pg_restore exits non-zero on ignorable noise too. The check that actually
    # matters is whether tables landed, so that is what decides.
    $after = Get-TableCount
    if (-not $after -or $after -eq '0') {
        Fail "La restauración no dejó ninguna tabla. Salida completa:

$(($out | ForEach-Object { "$_" }) -join "`n")" @"
Verificá que el archivo sea un dump de formato custom (-Fc):

  & "$($script:PgBin)\pg_restore.exe" -l "$file" | Select-Object -First 10
"@
    }
    Ok "Restauradas $after tabla(s) desde $(Split-Path -Leaf $file)"
}

# --------------------------------------------------------------------------
# Boot task (native Task Scheduler — no NSSM, nothing downloaded)
# --------------------------------------------------------------------------
function Get-BootTask {
    return (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)
}

function Install-BootTask {
    Step 'Arranque automático (Programador de tareas de Windows)'

    if (-not (Test-Administrator)) {
        Fail 'Esto necesita permisos de administrador: registra una tarea que corre como SYSTEM y abre un puerto en el firewall.' @'
Abrí PowerShell como administrador (clic derecho -> Ejecutar como
administrador) y repetí el comando:

  powershell -ExecutionPolicy Bypass -File scripts\windows\standalone.ps1 install-service
'@
    }

    # The task runs `next start`, which serves an already-built .next and
    # refuses to boot without one. Checking here turns a restart loop nobody
    # would look for into a message.
    if (-not (Test-Path -LiteralPath (Join-Path $Root '.next'))) {
        Fail "No hay build: falta $Root\.next, y el servicio corre 'next start', que sin build no levanta." @'
Compilá primero y después instalá el servicio:

  powershell -ExecutionPolicy Bypass -File scripts\windows\standalone.ps1 -SetupOnly
  npm.cmd run build
  powershell -ExecutionPolicy Bypass -File scripts\windows\standalone.ps1 install-service
'@
    }

    if (-not (Test-Path -LiteralPath $EnvFile)) {
        Fail 'Falta .env — el servicio arrancaría y se caería al instante sin DATABASE_URL.' @'
  Copy-Item env.example .env

Después corregí DATABASE_URL y volvé a correr install-service.
'@
    }

    if (-not (Get-EnvValue $EnvFile 'DATABASE_URL')) {
        Fail 'DATABASE_URL no está definida en .env, que es lo único que la app exige para arrancar.' @"
Agregala a .env y reintentá:

  DATABASE_URL=postgres://${DbUser}:${DbPassword}@${PgHost}:${PgPort}/${DbName}
"@
    }

    if (-not (Test-Path -LiteralPath $Wrapper)) {
        Fail "Falta $Wrapper, que es lo que la tarea ejecuta." @'
Está en el repo; si desapareció, recuperalo:

  git checkout -- scripts/windows/service-start.ps1
'@
    }

    # node comes from an installer that may have put it anywhere, and SYSTEM's
    # PATH is not the operator's. Baking the absolute directory resolved right
    # now is what keeps the task from dying at boot with 'npm no se reconoce'.
    $nodeDir = Resolve-NodeDir
    if (-not $nodeDir) {
        Fail "No encontré 'node' en el PATH, así que no sé qué PATH ponerle a la tarea." @'
Instalá Node 20 o más nuevo con el instalador oficial (que lo deja en
C:\Program Files\nodejs y en el PATH de toda la máquina) y reintentá:

  winget install OpenJS.NodeJS.LTS
'@
    }
    if (-not (Test-Path -LiteralPath (Join-Path $nodeDir 'npm.cmd'))) {
        Fail "Encontré node en $nodeDir pero no npm.cmd al lado, y la tarea arranca la app con npm." @'
Reinstalá Node con el instalador oficial:

  winget install OpenJS.NodeJS.LTS
'@
    }

    # A per-user Node (nvm-windows, or a portable unzip inside a profile) is
    # invisible to SYSTEM. Warned, not refused: it can still work if the folder
    # permissions allow it, and refusing on a guess would be worse.
    if ($nodeDir -like "$env:USERPROFILE*") {
        Warn "node está dentro de tu perfil ($nodeDir)."
        Note 'La tarea corre como SYSTEM, que tiene otro perfil: si esa carpeta no le'
        Note 'da lectura, la app no va a arrancar al encender. Lo prolijo es instalar'
        Note 'Node para toda la máquina (winget install OpenJS.NodeJS.LTS).'
    }

    # OneDrive redirects Escritorio/Documentos and can leave files "on demand",
    # which a SYSTEM process cannot page in. No hard refusal here because it is
    # not verified on this machine — but it is the first thing to suspect.
    if ($Root -like '*OneDrive*') {
        Warn "El repo está dentro de OneDrive ($Root)."
        Note 'Los archivos "a pedido" de OneDrive se descargan cuando los abre la sesión'
        Note 'del usuario, no SYSTEM. Si la app no arranca al encender, mové el repo'
        Note 'a una carpeta fuera de OneDrive, por ejemplo C:\dforce-catalog.'
    }

    # Stopping any existing instance before the port check, so that whatever is
    # still on the port afterwards is genuinely somebody else's.
    #
    # The wait is not defensive padding: Stop-ScheduledTask returns before the
    # process it started has released the socket, and without this a second
    # install-service reports "el puerto ya está ocupado" about its OWN previous
    # run and refuses. Same shape of race as the macOS script's bootout wait.
    if (Get-BootTask) {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        $waited = 0
        while ((Get-PortListener $Port) -and $waited -lt 20) {
            $waited++
            Start-Sleep -Seconds 1
        }
    }

    $listener = Get-PortListener $Port
    if ($listener) {
        $owner = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
        Fail "El puerto $Port ya está ocupado por '$($owner.ProcessName)' (PID $($listener.OwningProcess)), así que el servicio no podría arrancar." @"
Mirá quién lo tiene:

  Get-NetTCPConnection -LocalPort $Port -State Listen |
    Select-Object LocalPort, OwningProcess

Si es un 'next dev' o una corrida vieja de este script, bajala primero. O dejá
el servicio en otro puerto:

  .\scripts\windows\standalone.ps1 install-service -Port <puerto>
"@
    }

    # --- the account decision, stated out loud -----------------------------
    # SYSTEM, with LogonType ServiceAccount. The alternative — the operator's
    # own account with "run whether the user is logged on or not" — makes Task
    # Scheduler store that account's password, which then breaks the boot path
    # silently the next time the password changes. SYSTEM stores no password
    # and needs no session at all.
    $principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' `
                                            -LogonType ServiceAccount `
                                            -RunLevel Highest

    # At STARTUP, not at logon: a power cut has to bring the app back with
    # nobody logged in.
    $trigger = New-ScheduledTaskTrigger -AtStartup

    # ExecutionTimeLimit 0 = never kill it (the default is 3 days).
    # RestartInterval/RestartCount = restart it if it dies, which is the whole
    # point; service-start.ps1 turns even a clean exit into a failure so this
    # actually fires.
    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -MultipleInstances IgnoreNew `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -RestartCount 999

    $powershellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $argumentLine = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Port {1} -NodeDir "{2}"' `
                    -f $Wrapper, $Port, $nodeDir
    $action = New-ScheduledTaskAction -Execute $powershellExe -Argument $argumentLine -WorkingDirectory $Root

    # -Force rewrites an existing task, which is what makes this re-runnable
    # after a Node upgrade or a moved checkout.
    $registerError = $null
    $registered = Register-ScheduledTask -TaskName $TaskName `
        -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
        -Description 'Dforce Catalogo: arranca la app al encender la maquina.' `
        -Force -ErrorAction SilentlyContinue -ErrorVariable registerError

    if (-not $registered) {
        Fail "El Programador de tareas no aceptó la tarea. Dijo:

$(($registerError | ForEach-Object { "$_" }) -join "`n")" @"
Probá a mano para ver el error completo:

  Register-ScheduledTask -TaskName $TaskName -Action `$action -Trigger `$trigger ``
    -Principal `$principal -Settings `$settings -Force

Y verificá que la consola sea de administrador:

  ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole('Administrators')
"@
    }
    Ok "Tarea '$TaskName' registrada (al iniciar el sistema, reinicio automático)"
    Note 'corre como SYSTEM: no guarda ninguna contraseña y no necesita que nadie'
    Note 'inicie sesión — pero la app queda con permisos totales sobre la máquina'
    Note "node tomado de $nodeDir (el PATH de SYSTEM no es el tuyo)"

    # A SYSTEM process at boot never gets the "allow this app" firewall dialog:
    # that dialog only appears for a process in an interactive session. Without
    # an explicit rule the LAN URL printed below would simply not answer.
    Remove-NetFirewallRule -DisplayName $FirewallRuleName -ErrorAction SilentlyContinue
    $rule = New-NetFirewallRule -DisplayName $FirewallRuleName `
        -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port `
        -Profile Private, Domain -ErrorAction SilentlyContinue
    if ($rule) {
        Ok "Regla de firewall abierta para el puerto $Port (perfiles Privado y Dominio)"
        Note 'no se abre en el perfil Público a propósito: en una red que Windows'
        Note 'considera pública, el catálogo no debería contestar'
    }
    else {
        Warn "No pude crear la regla de firewall para el puerto $Port."
        Note 'Sin ella, las otras máquinas del taller no van a poder entrar. A mano:'
        Note "New-NetFirewallRule -DisplayName '$FirewallRuleName' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Private,Domain"
    }

    Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

    # The part that is worth printing: whether it actually came up. Everything
    # above only proves Windows accepted the task description.
    Write-Host -NoNewline "  esperando a que la app conteste en el puerto $Port"
    $waited = 0
    while (-not (Test-AppAnswers $Port)) {
        $waited++
        if ($waited -ge 60) {
            Write-Host ''
            Fail "Registré la tarea pero la app no contestó en 60s en el puerto $Port." @"
El motivo real está en el log del servicio:

  Get-Content "$SystemLogFile" -Tail 50

(esa ruta es la de SYSTEM: hay que leerla desde una consola de administrador)

Causas típicas: falta el build (npm.cmd run build), DATABASE_URL apunta a un
Postgres que no está, o el puerto lo tiene otro proceso:

  Get-NetTCPConnection -LocalPort $Port -State Listen
"@
        }
        Write-Host -NoNewline '.'
        Start-Sleep -Seconds 1
    }
    Write-Host ''
    Ok "La app contesta en http://localhost:$Port"

    $ip = Get-LanIPv4
    if ($ip) {
        Ok "Desde las otras máquinas: http://${ip}:$Port"
        Note 'esa IP viene del DHCP del router y puede cambiar: reservala en el router'
        Note 'si no querés que los favoritos del taller se rompan solos'
    }
    else {
        Warn 'No pude averiguar la IP de la LAN (ningún adaptador activo con gateway)'
        Note 'sin red no hay URL para las otras máquinas; reintentá cuando haya cable o WiFi'
    }

    Note "log del servicio: $SystemLogFile"
    Note 'desinstalarlo: .\scripts\windows\standalone.ps1 uninstall-service'
}

function Uninstall-BootTask {
    Step 'Quitando el arranque automático'

    if (-not (Test-Administrator)) {
        Fail 'Esto necesita permisos de administrador.' @'
Abrí PowerShell como administrador y repetí:

  powershell -ExecutionPolicy Bypass -File scripts\windows\standalone.ps1 uninstall-service
'@
    }

    if (Get-BootTask) {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
        if (Get-BootTask) {
            Fail "No pude borrar la tarea '$TaskName'." @"
Probá a mano desde una consola de administrador:

  Unregister-ScheduledTask -TaskName $TaskName -Confirm:`$false
"@
        }
        Ok 'Tarea borrada'
    }
    else {
        Ok 'No había tarea que borrar'
    }

    $rule = Get-NetFirewallRule -DisplayName $FirewallRuleName -ErrorAction SilentlyContinue
    if ($rule) {
        Remove-NetFirewallRule -DisplayName $FirewallRuleName -ErrorAction SilentlyContinue
        Ok 'Regla de firewall quitada'
    }
    else {
        Ok 'No había regla de firewall que quitar'
    }

    Note 'Postgres sigue corriendo: es su propio servicio de Windows, no nuestro'
    Note '(pararlo, si lo querés: Stop-Service postgresql-x64-17)'
    Note "el log queda donde estaba: $SystemLogFile"
}

# --------------------------------------------------------------------------
# status
# --------------------------------------------------------------------------
function Show-Status {
    $script:PgBin = Resolve-PgBin
    Step 'Estado'

    $service = Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($service) {
        if ($service.Status -eq 'Running') { Ok "Servicio '$($service.Name)': $($service.Status)" }
        else { Warn "Servicio '$($service.Name)': $($service.Status) (Start-Service $($service.Name))" }
    }
    else {
        Warn 'No hay ningún servicio de PostgreSQL instalado'
    }

    if ($script:PgBin -and (Test-PgUp)) {
        Ok "Postgres acepta conexiones en ${PgHost}:${PgPort}"
        $count = Get-TableCount
        if ($count) { Ok "Base '$DbName': $count tabla(s)" }
        else { Warn "La base '$DbName' no existe todavía (o el rol '$DbUser' no puede leerla)" }
    }
    else {
        Warn "Postgres NO contesta en ${PgHost}:${PgPort}"
    }
    Note "binarios: $(if ($script:PgBin) { $script:PgBin } else { '(no encontrados)' })"
    Note "backups:  $BackupDir"

    if (Test-Path -LiteralPath $EnvFile) {
        $url = Get-EnvValue $EnvFile 'DATABASE_URL'
        if ($url -match ":$PgPort/")           { Ok ".env apunta al Postgres local ($PgPort)" }
        elseif ($url -match ":$DockerPgPort/") { Warn ".env todavía apunta al Postgres de Docker ($DockerPgPort)" }
        else                                   { Warn '.env apunta a un Postgres que no es ninguno de los dos' }
    }
    else {
        Warn 'No hay .env'
    }

    Step 'Arranque automático de la app'
    $task = Get-BootTask
    if ($task) {
        $info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
        Ok "Tarea '$TaskName' instalada — estado: $($task.State)"
        if ($info) {
            Note "última corrida: $($info.LastRunTime)  resultado: $($info.LastTaskResult)"
        }
        if (Test-AppAnswers $Port) { Ok "La app contesta en http://localhost:$Port" }
        else { Warn "La tarea existe pero nada contesta en el puerto $Port" }
    }
    else {
        Warn 'No hay tarea instalada — después de un reinicio la app NO vuelve sola'
        Note 'instalarla: .\scripts\windows\standalone.ps1 install-service'
    }

    if (Get-NetFirewallRule -DisplayName $FirewallRuleName -ErrorAction SilentlyContinue) {
        Ok "Firewall: regla '$FirewallRuleName' presente"
    }
    else {
        Warn 'Firewall: no hay regla para este puerto — las otras máquinas no van a entrar'
    }

    Note "log: $SystemLogFile"

    $ip = Get-LanIPv4
    if ($ip) { Note "LAN: http://${ip}:$Port" }
    else     { Note 'LAN: sin IP en ningún adaptador activo — las otras máquinas no pueden entrar' }
}

# --------------------------------------------------------------------------
# setup + start
# --------------------------------------------------------------------------
function Invoke-Setup {
    param([switch] $SetupOnlyMode)

    Step 'Prerrequisitos'
    foreach ($c in @('node', 'npm.cmd')) {
        if (-not (Get-Command $c -ErrorAction SilentlyContinue)) {
            Fail "No encontré el comando '$c' en el PATH." @'
Instalá Node 20 o más nuevo:

  winget install OpenJS.NodeJS.LTS

Cerrá y volvé a abrir PowerShell después de instalarlo (el PATH se refresca
recién en una consola nueva).
'@
        }
    }
    Ok 'node y npm disponibles'

    if (-not $SetupOnlyMode) {
        $listener = Get-PortListener $Port
        if ($listener) {
            $owner = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
            Fail "El puerto $Port ya está ocupado por '$($owner.ProcessName)' (PID $($listener.OwningProcess))." @"
Mirá quién lo tiene:

  Get-NetTCPConnection -LocalPort $Port -State Listen

Si es una corrida vieja de este mismo stack, matala:

  Stop-Process -Id $($listener.OwningProcess)

O usá otro puerto:

  .\scripts\windows\standalone.ps1 -Port <puerto>
"@
        }
    }

    Start-PostgresService
    Initialize-RoleAndDatabase
    Initialize-EnvFile
    Invoke-Migrations
    Initialize-FirstUser
    Initialize-PlaywrightChromium
}

function Invoke-Start {
    Invoke-Setup

    Step 'Compilando'
    Push-Location $Root
    $out = & npm.cmd run --silent build 2>&1
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) {
        Fail "El build de Next falló. Salida completa:

$(($out | ForEach-Object { "$_" }) -join "`n")" 'Arreglá los errores de arriba y volvé a correr el script.'
    }
    Ok 'Build listo'

    Step 'Arrancando la app'
    Write-Host ''
    Write-Host "  App  -> http://localhost:$Port" -ForegroundColor Green
    $ip = Get-LanIPv4
    if ($ip) {
        Write-Host "  LAN  -> http://${ip}:$Port" -ForegroundColor Green
        Note 'la primera vez Windows puede preguntar si permite conexiones entrantes:'
        Note 'hay que aceptar, o las otras máquinas no ven nada'
    }
    else {
        Write-Host '  LAN  -> sin IP en ningún adaptador activo: las otras máquinas no pueden entrar' -ForegroundColor Red
    }
    Write-Host ''
    Write-Host '  Ctrl-C la baja. Postgres queda corriendo como servicio de Windows.' -ForegroundColor DarkGray
    Write-Host ''

    $env:DATABASE_URL = $script:DatabaseUrl
    Push-Location $Root
    & npm.cmd run start -- --port $Port
    $exitCode = $LASTEXITCODE
    Pop-Location
    exit $exitCode
}

function Show-Help {
    Write-Host @'
Dforce Catálogo — despliegue en Windows sin Docker.

  standalone.ps1                        setup + build + arranque
  standalone.ps1 -SetupOnly             base lista, la app no arranca
  standalone.ps1 install-service        arranca la app al encender la máquina
  standalone.ps1 uninstall-service      quita esa tarea y su regla de firewall
  standalone.ps1 status                 qué está corriendo y a dónde apunta .env
  standalone.ps1 backup                 pg_dump -Fc a %USERPROFILE%\dforce-backups
  standalone.ps1 restore <archivo>      restaura un dump (pregunta y respalda antes)

Parámetros: -Port 3000  -PgPort 5432  -PgHost localhost  -SuperPassword <clave>
            -SeedUser admin  -SeedPassword admin123  -BackupDir <carpeta>  -Yes

Todo esto se corre así (PowerShell 5.1 no ejecuta scripts sin permiso):

  powershell -ExecutionPolicy Bypass -File scripts\windows\standalone.ps1 <comando>

Más detalle en WINDOWS.md.
'@
}

# --------------------------------------------------------------------------
# Dispatch
# --------------------------------------------------------------------------
switch ($Command.ToLowerInvariant()) {
    'backup'            { Invoke-Backup; break }
    'restore'           { Invoke-Restore $Arg; break }
    'status'            { Show-Status; break }
    'install-service'   { Install-BootTask; break }
    'uninstall-service' { Uninstall-BootTask; break }
    'help'              { Show-Help; break }
    '-h'                { Show-Help; break }
    '--help'            { Show-Help; break }
    '' {
        if ($SetupOnly) {
            Invoke-Setup -SetupOnlyMode
            Write-Host ''
            Write-Host '[OK] Todo listo.' -ForegroundColor Green
            Write-Host ''
            Write-Host '  Arrancar la app:     npm.cmd run build; npm.cmd start'
            Write-Host '  Al encender:         .\scripts\windows\standalone.ps1 install-service'
            Write-Host '  Backup:              .\scripts\windows\standalone.ps1 backup'
            Write-Host ''
        }
        else {
            Invoke-Start
        }
        break
    }
    default {
        Fail "No conozco la opción '$Command'." 'powershell -ExecutionPolicy Bypass -File scripts\windows\standalone.ps1 help'
    }
}
