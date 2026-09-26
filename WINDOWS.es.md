# Ejecución en Windows (sin Docker)
> Traducción de [WINDOWS.md](WINDOWS.md). Ante cualquier diferencia, la versión en inglés es la de referencia.

La contraparte para Windows de `STANDALONE.md`: la aplicación, un PostgreSQL
instalado como un servicio real de Windows y una tarea del Programador de tareas
que levanta ambos después de un corte de energía sin que nadie haya iniciado
sesión. Sin Docker, sin NSSM, nada descargado fuera de los instaladores
oficiales.

Todo vive en dos scripts:

| Archivo | Qué es |
|---------|--------|
| `scripts\windows\standalone.ps1` | Configuración, build, arranque, respaldo/restauración y la tarea de arranque. El port de `scripts/standalone.sh` |
| `scripts\windows\service-start.ps1` | Lo que la tarea de arranque ejecuta realmente. Espera a Postgres, luego inicia la aplicación y registra ambos en el log |

`scripts\migrate.mjs` y `scripts\seed-user.mjs` son Node multiplataforma y se
quedan donde están; estos scripts los invocan ahí.

## Requisitos

| Requisito | Por qué decide si esto funciona o no |
|-----------|--------------------------------------|
| **Windows 10 Pro** con el PowerShell 5.1 integrado | Ambos scripts apuntan a 5.1 a propósito. PowerShell 7 no es necesario y no se asume |
| **PostgreSQL 17**, instalado ejecutando el instalador oficial de EDB **a mano** | Registra un servicio real de Windows (`postgresql-x64-17`) que arranca solo con el sistema. Ejecute usted mismo el `.exe` descargado y anote la contraseña del superusuario `postgres` que le pide: el script de configuración la necesita una vez, para crear el rol y la base de datos. **No** lo instale con `winget`; vea más abajo |
| **Node 20+ instalado a nivel de máquina** | La tarea de arranque se ejecuta como `SYSTEM`, cuyo `PATH` no es el suyo. `install-service` resuelve `node` en el momento de la instalación y fija el directorio absoluto dentro de la tarea, exactamente como la versión para macOS lo fija en el plist. Un Node por usuario (nvm-windows, un zip portable descomprimido dentro de su perfil) puede no ser legible para `SYSTEM`; el script lo advierte |
| El checkout **fuera** de OneDrive | Los "archivos a petición" de OneDrive los pagina la sesión del usuario que inició sesión, no `SYSTEM`. `C:\dforce-catalog` es un buen lugar. Aquí el script advierte en lugar de rechazar, porque este punto no está verificado |

## Secuencia de instalación

PowerShell 5.1 no ejecuta scripts sin firmar por defecto, así que cada comando
de abajo pasa por `-ExecutionPolicy Bypass`.

Esa misma política es la razón por la que cada `npm` de abajo se escribe
**`npm.cmd`**. En Windows `npm` se resuelve primero a `npm.ps1`, y PowerShell
se niega a cargarlo:

```
npm : File C:\Program Files\nodejs\npm.ps1 cannot be loaded because running
scripts is disabled on this system.
```

`npm.cmd` es el wrapper por lotes que está a su lado y ejecuta exactamente lo
mismo, así que evita la política sin cambiar ninguna configuración a nivel de
máquina. Cada llamada a `npm` y `npx` dentro de los scripts ya pasa por `.cmd`
por esta razón.

Descargue PostgreSQL 17 desde
<https://www.postgresql.org/download/windows/> y **ejecute el instalador a
mano**. Pide una contraseña de superusuario en pantalla; anótela.

**No instale PostgreSQL con `winget`.** `winget` lo ejecuta como
`--mode unattended --unattendedmodeui none`, así que esa pantalla de contraseña
nunca aparece y el instalador establece una que nunca se le mostró. Lo primero
que sabrá de ella es `FATAL: password authentication failed for user "postgres"`,
sin nada que escribir. Recuperarse de eso implica editar `pg_hba.conf`; vea
"Postgres instalado con winget" más abajo. Node está bien de cualquier forma.

```powershell
winget install OpenJS.NodeJS.LTS
# cierre y vuelva a abrir PowerShell: el PATH solo se refresca en una consola nueva

cd C:\dforce-catalog
npm.cmd ci
powershell -ExecutionPolicy Bypass -File scripts\windows\standalone.ps1
```

Ese último comando hace toda la configuración y luego construye e inicia la
aplicación en primer plano: comprueba que el servicio de PostgreSQL está
instalado y responde, crea el rol `dforce` y la base de datos `dforce_catalog`
si no existen, copia `env.example` a `.env` si no hay ninguno, apunta
`DATABASE_URL` al puerto local de Postgres, ejecuta las migraciones, crea un
administrador `admin` cuando la tabla `users` está vacía, descarga el Chromium
de Playwright si falta, y construye.

Cada paso comprueba primero su propio estado, así que una ejecución que falla a
mitad de camino se reanuda ejecutando el mismo comando otra vez. Cuando algo se
rompe, imprime qué está mal y el comando exacto que lo arregla, y luego sale con
código distinto de cero.

Una vez que lo haya visto funcionar, deténgalo con `Ctrl-C` e instale la tarea
de arranque desde un PowerShell de **administrador**:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\standalone.ps1 install-service
```

## Comandos

| Comando | Qué hace |
|---------|----------|
| `standalone.ps1` | Configuración completa, `next build`, luego `next start` en primer plano |
| `standalone.ps1 -SetupOnly` | Base de datos lista, aplicación sin iniciar |
| `standalone.ps1 install-service` | Registra la tarea de arranque y la regla del firewall (requiere administrador) |
| `standalone.ps1 uninstall-service` | Elimina ambas; PostgreSQL queda intacto (requiere administrador) |
| `standalone.ps1 status` | Qué está corriendo, a qué apunta `.env`, si la tarea existe y si la aplicación responde |
| `standalone.ps1 backup` | `pg_dump -Fc` en `%USERPROFILE%\dforce-backups` |
| `standalone.ps1 restore <file>` | Restaura un dump; pregunta primero y respalda el estado actual antes de reemplazarlo |

Parámetros: `-Port` (3000), `-PgHost` (localhost), `-PgPort` (5432),
`-SuperPassword`, `-SeedUser` / `-SeedPassword`, `-BackupDir`, `-Yes` (omite la
confirmación de la restauración en una shell no interactiva).

## La tarea de arranque y lo que cuesta

`install-service` registra una tarea del Programador de tareas llamada
`DforceCatalogo`:

- **Se dispara al inicio del sistema**, no al iniciar sesión. Un corte de
  energía tiene que levantar la aplicación sin que nadie haya iniciado sesión,
  que es la razón entera por la que esto existe.
- **Se ejecuta haya o no un usuario con sesión iniciada**, porque corre bajo una
  cuenta de servicio.
- **Se reinicia automáticamente** si el proceso muere: cada minuto, hasta 999
  veces.

### Se ejecuta como SYSTEM, y eso es un intercambio real

El Programador de tareas ofrece exactamente dos formas de conseguir "al inicio,
con o sin sesión iniciada":

| Cuenta | Qué cuesta |
|--------|------------|
| Una cuenta de usuario normal | El Programador de tareas **almacena la contraseña de esa cuenta** al registrar la tarea. Hay que escribirla, y la próxima vez que la contraseña cambie (una política de TI, un vencimiento) la tarea falla al arrancar con un error de credenciales y nadie se entera hasta que el taller llama |
| `SYSTEM` (la elegida) | Nunca se almacena ni se escribe una contraseña. Nada que vencer. Pero la aplicación corre con **privilegios totales sobre la máquina**: un bug de ejecución remota de código en la aplicación es un compromiso de la máquina, no de una cuenta de usuario |

`SYSTEM` es lo que elige este repositorio. El razonamiento es el mismo que
`STANDALONE.md` aplica a FileVault: la falla que importa en una máquina de
taller sin supervisión es la silenciosa, y una contraseña almacenada que caduca
meses después es exactamente eso. Un límite de privilegios visible es mejor que
una ruta de arranque que se rompe en silencio.

Dicho con claridad: **esta aplicación se ejecuta como la cuenta más privilegiada
de esa máquina Windows.** Si eso no es aceptable, la alternativa es una cuenta
local dedicada de bajos privilegios con "iniciar sesión como trabajo por lotes"
y una contraseña almacenada: más piezas móviles de las que tiene este despliegue,
y no está implementada aquí.

Dos consecuencias de `SYSTEM` que ya están resueltas, y que vale la pena conocer
porque son de las que fallan en silencio:

- **`SYSTEM` tiene su propio perfil**, así que una caché por usuario no es la
  suya. Playwright resuelve Chromium desde un directorio de caché, así que tanto
  el paso de instalación como el servicio fijan `PLAYWRIGHT_BROWSERS_PATH` en
  `C:\ProgramData\ms-playwright`. Sin eso, todo funcionaría excepto la
  generación de PDFs del catálogo, y nada diría por qué.
- **`SYSTEM` no tiene unidades de red mapeadas.** El repositorio y la base de
  datos tienen que estar en discos locales.

### Se puede volver a ejecutar

`install-service` reescribe la tarea cada vez (`Register-ScheduledTask -Force`).
Ejecútelo de nuevo después de una actualización de Node, de mover el checkout o
de cambiar el puerto. Rechaza en lugar de adivinar: sin build en `.next`, sin
`.env`, sin `DATABASE_URL`, sin `node`, puerto ya ocupado, sin ejecutarse como
administrador.

Después de registrarla **inicia la tarea y sondea el puerto**, y luego informa
si la aplicación realmente respondió, que es una pregunta distinta de si Windows
aceptó la tarea.

## Qué esperar

### El firewall

`install-service` crea una regla TCP de entrada para el puerto de la aplicación
en los perfiles **Privado y Dominio**. No abre el perfil Público: en una red que
Windows clasifica como pública, el catálogo no debería responder.

Esta regla no es una comodidad. Un proceso que corre como `SYSTEM` al arrancar
nunca recibe el diálogo de "permitir que esta aplicación se comunique"; ese
diálogo solo aparece para un proceso en una sesión de escritorio interactiva.
Sin una regla explícita, la URL de la LAN simplemente no respondería, sin aviso
y sin error.

Ejecutar `standalone.ps1` a mano en primer plano **sí** corre en su sesión, así
que esa primera ejecución es donde puede ver el diálogo. Haga clic en Permitir.

### La URL de la LAN cambia

`next start` escucha en `0.0.0.0` (el hostname por defecto de Next 16), así que
las otras máquinas del taller lo alcanzan sin ningún flag adicional; simplemente
nunca se les dijo la dirección. `install-service`, una ejecución normal y
`status` la imprimen, tomada del primer adaptador activo que tiene una puerta de
enlace IPv4 por defecto. Cuando nada se resuelve lo dice, en lugar de imprimir
una URL vacía o adivinada.

Esa dirección viene de DHCP y puede cambiar. Una dirección reservada en el
router es lo que evita que los marcadores del personal dejen de servir.

### Nunca suspender

Un PC suspendido no responde nada en la LAN. Desde un PowerShell de
administrador:

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change disk-timeout-ac 0
powercfg /hibernate off
```

Apagar el monitor puede dejarse activado; no es suspensión.

Dos más, fuera de Windows:

- **"Restore on AC power loss" en el BIOS/UEFI.** Sin eso la máquina queda
  apagada después de un corte de energía y nada de esto se ejecuta. La opción
  suele estar bajo Power Management y se llama algo como *Restore on AC Power
  Loss*, *AC Back Function* o *After Power Failure*; póngala en *Power On* /
  *Last State*. No hay forma de configurar esto desde Windows.
- **En una laptop, cerrar la tapa** la suspende sin importar los tiempos de
  espera anteriores. Configure *Elegir lo que hace el cierre de la tapa* en
  *No hacer nada* mientras está conectada, o deje la tapa abierta.

### Leer el registro

Todo lo que imprime el servicio (las propias líneas con marca de tiempo de
`service-start.ps1` más todo el stdout y stderr de Next) va a un solo archivo,
bajo el `%LOCALAPPDATA%` de la cuenta de la tarea. Como `SYSTEM` eso se resuelve
a:

```
C:\Windows\System32\config\systemprofile\AppData\Local\dforce-catalog\service.log
```

`install-service` y `status` imprimen esa ruta exacta. Leerlo requiere una
consola de administrador:

```powershell
Get-Content "$env:SystemRoot\System32\config\systemprofile\AppData\Local\dforce-catalog\service.log" -Tail 50
```

Rota una vez a los 10 MB (`service.log.1`). La otra mitad del panorama es la
tarea en sí:

```powershell
Get-ScheduledTask -TaskName DforceCatalogo
Get-ScheduledTaskInfo -TaskName DforceCatalogo   # LastRunTime, LastTaskResult
```

### Postgres no lo supervisamos nosotros

El instalador de EDB ya registró `postgresql-x64-17` con el administrador de
servicios propio de Windows, configurado para arrancar automáticamente. Nada
aquí lo duplica, y `uninstall-service` lo deja en ejecución deliberadamente.

Lo que eso crea es una carrera: al arrancar, ambos inician a la vez, y
`next start` puede llegar a un Postgres que todavía no acepta conexiones. Esa
falla **no** parece un crash: la aplicación sigue escuchando y responde a cada
petición con un **500**, registrando solo
`An error occurred while loading instrumentation hook`, porque la mitad que
necesitaba la base de datos es `src/instrumentation.ts`, que registra los
workers de pg-boss al arrancar. Un supervisor ve un proceso sano y lo deja ahí
sirviendo 500 para siempre.

Por eso la tarea no ejecuta `standalone.ps1`. Ejecuta `service-start.ps1`, cuyo
único trabajo es sondear `pg_isready.exe` antes de pasar el control a
`npm run start`. Lee el host y el puerto del `DATABASE_URL` de `.env` en lugar
de asumir 5432; en una máquina que todavía tiene Docker, `.env` apunta
legítimamente a 5433. Si Postgres nunca responde en 60 segundos, sale con código
distinto de cero con la razón y el comando que lo arregla en el log, en lugar de
iniciar una aplicación que mentiría sobre estar levantada.

Una particularidad específica de Windows: el Programador de tareas solo reinicia
una tarea que **termina en falla**, así que un `exit 0` limpio de la aplicación
dejaría al taller sin aplicación y con una tarea que la consola reporta
alegremente como "completada correctamente". Por eso `service-start.ps1`
reporta una salida con cero como falla: la aplicación nunca debería salir.

### Actualizar el código sigue siendo un paso manual

La tarea ejecuta `next start`, que sirve el `.next` ya construido. No hace pull,
no instala, no migra ni construye.

Deliberadamente no automatizado. Un `git pull && build` sin supervisión en la
máquina de la que depende el taller convierte un commit malo en una caída que
nadie está mirando.

**Antes de tocar nada**: un respaldo y el commit al que volver:

```powershell
cd C:\dforce-catalog
powershell -ExecutionPolicy Bypass -File scripts\windows\standalone.ps1 backup
git rev-parse --short HEAD    # anote esto: es el objetivo del rollback
```

**La actualización:**

```powershell
git pull
npm.cmd ci
powershell -ExecutionPolicy Bypass -File scripts\windows\standalone.ps1 -SetupOnly
npm.cmd run build
powershell -ExecutionPolicy Bypass -File scripts\windows\standalone.ps1 install-service
```

`-SetupOnly` ejecuta las migraciones pendientes (idempotente: una versión sin
cambios de esquema no hace nada ahí). `install-service` vuelve a registrar la
tarea, reinicia la aplicación e imprime la URL de la LAN.

**Después:**

1. Abra la aplicación **desde otra máquina, en la IP de la LAN**, no en el
   servidor. La clase de bug de contexto inseguro (`AGENTS.md`, Testing, tercer
   límite conocido) solo es visible ahí.
2. Recorra lo que cambió la versión. La lista de PRs en `main` desde el commit
   de rollback es la lista de verificación:
   `git log --oneline --merges <commit>..HEAD`.

**Rollback**: primero el código, la base de datos solo si realmente cambió:

```powershell
git checkout <commit written down above>
npm.cmd ci
npm.cmd run build
powershell -ExecutionPolicy Bypass -File scripts\windows\standalone.ps1 install-service
# solo si corrió una migración y hay que deshacerla:
powershell -ExecutionPolicy Bypass -File scripts\windows\standalone.ps1 restore <dump from the backup above>
```

Ya que está en la máquina, revise también las dos configuraciones que viven
fuera de Windows y deciden si la URL sobrevive a un corte de energía: la
**reserva DHCP** en el router y **"Restore on AC Power Loss"** en el BIOS; vea
"La URL de la LAN cambia" y "Nunca suspender" más arriba.

## El único cambio en `.env`

```diff
-DATABASE_URL=postgres://dforce:dforce@localhost:5433/dforce_catalog
+DATABASE_URL=postgres://dforce:dforce@localhost:5432/dforce_catalog
```

5433 es el puerto del host que publica compose; 5432 es donde responde un
Postgres instalado localmente. `standalone.ps1` reescribe exactamente esa línea,
deja un `.env.bak-*` con marca de tiempo a su lado, y escribe el archivo de
vuelta como **UTF-8 sin BOM**: `Out-File` en PowerShell 5.1 escribiría UTF-16,
y su `-Encoding utf8` antepondría un BOM que llega pegado al nombre de la primera
clave y rompe `.env` para Node.

Esta es la falla que vale la pena entender porque no parece una: con Postgres en
5432 y `.env` todavía apuntando a 5433 (o al revés), la aplicación se conecta
con éxito a la base de datos *equivocada* y simplemente se muestra vacía. Nada
registra un error. `standalone.ps1 status` imprime a cuál apunta `.env`.

## Respaldos

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\standalone.ps1 backup
# -> C:\Users\<you>\dforce-backups\dforce_catalog-20260911-143012.dump
```

Formato custom (`-Fc`), igual que la ruta de macOS, así que los dos son
intercambiables. `restore <file>` toma un respaldo fresco del estado actual antes
de reemplazar nada.

Uno nocturno es otra tarea programada:

```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument '-ExecutionPolicy Bypass -File C:\dforce-catalog\scripts\windows\standalone.ps1 backup' `
  -WorkingDirectory C:\dforce-catalog
$trigger = New-ScheduledTaskTrigger -Daily -At 2am
Register-ScheduledTask -TaskName DforceCatalogoBackup -Action $action -Trigger $trigger
```

Los respaldos viven fuera del repositorio: contienen datos reales de clientes y
nunca deben commitearse. Cópielos fuera de la máquina periódicamente; un
respaldo en el mismo disco que la base de datos solo protege contra errores, no
contra el disco.

## Cuando algo falla

| Síntoma | Causa | Solución |
|---------|-------|----------|
| `FATAL: password authentication failed for user "postgres"` | PostgreSQL se instaló con `winget`, que nunca mostró la pantalla de contraseña | "Postgres instalado con winget" más abajo |
| Todas las pantallas funcionan pero la sincronización de inventario/clientes no trae nada | La IP pública de esta máquina no está en la lista de permitidos de Interfuerza | "Interfuerza necesita la IP pública de esta máquina en su lista de permitidos" más abajo |
| `npm : File ...\npm.ps1 cannot be loaded because running scripts is disabled` | `npm` se resuelve a `npm.ps1`, que la política de ejecución por defecto bloquea | Use `npm.cmd` en su lugar: mismo programa, wrapper por lotes, ninguna configuración de máquina cambiada |
| `...standalone.ps1 cannot be loaded because running scripts is disabled` | Política de ejecución por defecto de PowerShell 5.1 | Ejecútelo como `powershell -ExecutionPolicy Bypass -File ...`, como hace cada comando de aquí |
| El texto con acentos se imprime como `Ã¡`, `Ã³` | El `.ps1` perdió su BOM UTF-8, así que 5.1 lo leyó como la página de códigos ANSI | Restáurelo desde git; no vuelva a guardar ninguno de los dos scripts sin el BOM |
| `No encontré ningún servicio de PostgreSQL` | PostgreSQL nunca se instaló, o se instaló como un zip portable sin servicio | Instálelo desde <https://www.postgresql.org/download/windows/>, ejecutando el .exe a mano, no con `winget` |
| `no me deja conectar como 'postgres'` | Contraseña de superusuario incorrecta | Pásela: `standalone.ps1 -SuperPassword <clave>`. Si se perdió, restablézcala poniendo `trust` en `pg_hba.conf`, reiniciando el servicio y ejecutando `ALTER USER` |
| Postgres responde en un puerto que no es 5432 | Otra instancia ya tenía el 5432 cuando corrió el instalador | Revise `port` en `postgresql.conf`, luego pase `-PgPort <n>` |
| Las migraciones fallan con `relation already exists` | Esquema aplicado pero no registrado | Compare `drizzle.__drizzle_migrations` con `src\shared\db\migrations\meta\_journal.json`. Esa tabla es la autoritativa; `public.__drizzle_migrations` es un residuo que nadie lee |
| La aplicación arranca, todo está vacío | `.env` apunta al otro Postgres | `standalone.ps1 status` |
| `install-service` dice que necesita administrador | Registrar una tarea SYSTEM y una regla de firewall requieren elevación | Clic derecho en PowerShell → Ejecutar como administrador |
| Tarea registrada, la aplicación nunca responde | Lea el log primero; dice cuál de estos fue | `Get-Content <la ruta de systemprofile de arriba> -Tail 50` |
| El log dice que Postgres nunca aceptó conexiones | El servicio de PostgreSQL no arrancó, o `DATABASE_URL` apunta a un puerto donde nada escucha | `Start-Service postgresql-x64-17`, luego `Start-ScheduledTask -TaskName DforceCatalogo` |
| El log dice que `npm` no se reconoce | El directorio de Node fijado ya no existe (una actualización lo movió) | Vuelva a ejecutar `install-service`; resuelve `node` de nuevo |
| La tarea muestra "completada correctamente" pero nada está corriendo | La aplicación salió limpiamente y el Programador de tareas no lo trató como falla | Ya no debería pasar: `service-start.ps1` reporta una salida con cero como falla. Si pasa, lea el log para saber por qué salió la aplicación |
| La aplicación responde en `localhost` pero no desde otras máquinas | No hay regla de firewall, o Windows clasificó la red como Pública | `standalone.ps1 status` muestra si la regla existe. Ponga la red en Privada en Configuración → Red |
| Ayer funcionaba, hoy las otras máquinas no obtienen nada | La concesión DHCP movió la IP | `standalone.ps1 status` imprime la actual. Resérvela en el router |
| La máquina quedó apagada después de un corte de energía | El "restore on AC power loss" del BIOS no está configurado | Configúrelo en el BIOS; Windows no puede |
| Los PDFs del catálogo fallan, todo lo demás funciona | Falta Chromium en `C:\ProgramData\ms-playwright` | `$env:PLAYWRIGHT_BROWSERS_PATH = "C:\ProgramData\ms-playwright"; npx.cmd playwright install chromium` |

## Postgres instalado con winget: recuperar la contraseña del superusuario

Solo es necesario si la trampa de arriba ya lo atrapó. No hay forma de leer la
contraseña de vuelta, así que la solución es establecer una nueva a través de
una puerta abierta temporalmente.

Desde un PowerShell de **administrador**. No escriba las rutas a mano: derívelas
del propio servicio, para que esto funcione sea cual sea la ubicación de la
instalación:

```powershell
$svc  = (Get-Service postgresql* | Select-Object -First 1).Name
$img  = (Get-CimInstance Win32_Service -Filter "Name='$svc'").PathName
$data = [regex]::Match($img, '-D\s+"([^"]+)"').Groups[1].Value
$hba  = Join-Path $data 'pg_hba.conf'
Test-Path $hba      # debe imprimir True antes de continuar
```

Luego ejecute estas seis líneas **como un solo pegado**:

```powershell
Copy-Item $hba "$hba.bak" -Force
(Get-Content $hba) -replace 'scram-sha-256','trust' -replace '\bmd5\b','trust' | Set-Content $hba
Restart-Service $svc
& "$(Split-Path (Split-Path $hba))\bin\psql.exe" -U postgres -h localhost -c "ALTER USER postgres PASSWORD '<your new password>';"
Copy-Item "$hba.bak" $hba -Force
Restart-Service $svc
```

**Las dos últimas líneas no son opcionales, y por eso esto es un solo pegado.**
Entre la línea 3 y la línea 5 ese Postgres acepta cualquier conexión local sin
contraseña alguna.

Verifique que la puerta se cerró de nuevo; este comando debe *pedir* la
contraseña:

```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -h localhost -c "SELECT version();"
```

Si responde sin pedirla, `pg_hba.conf` no se restauró. Arregle eso antes que
cualquier otra cosa.

## Interfuerza necesita la IP pública de esta máquina en su lista de permitidos

Esto no es algo de Windows: aplica a cualquier máquina en la que corra la
aplicación, y es la única falla que parece que la aplicación está rota cuando no
lo está.

La propia documentación de Interfuerza: *"Es obligatorio agregar en esta sección
todas las IPs desde las cuales se recibirán todas las llamadas al API."* Un
token válido no es suficiente. Las llamadas desde una dirección que no está en
su lista se rechazan, así que `inventory-sync` y `customer-import` fallan en una
máquina que nunca fue agregada a la lista, mientras todas las demás pantallas
funcionan normalmente.

Lea la dirección pública de esta máquina:

```powershell
(Invoke-WebRequest ifconfig.me/ip -UseBasicParsing).Content
```

Agréguela en **Configuración → Apps → InterFuerza Api → Configurar**, en la
sección de IPs.

Dos cosas que conviene saber antes de hacerlo:

- **Agregue a la lista solo la máquina que se queda.** La dirección de un equipo
  de prueba es desechable y ensucia la lista con una entrada que después nadie
  puede identificar.
- **Si la conexión es DHCP, esa dirección cambiará**, y la sincronización se
  rompe cuando lo haga, en silencio y sin ningún error en la aplicación. Una
  dirección fija del ISP es lo que evita eso.

Regenerar el token es inmediato y no tiene período de gracia: el API "comienza
a denegar cualquier integración que no use el nuevo Token", así que cada máquina
que lo use tiene que actualizarse en la misma sesión.

## Qué no se cubre aquí

- No hay importación desde un contenedor Docker. El script de macOS tiene una
  porque esa Mac estaba migrando desde compose; una máquina Windows nueva no
  tiene nada que importar. Mueva los datos con `backup` de un lado y `restore`
  del otro; ambos usan el mismo formato `pg_dump -Fc`.
- No hay modo `--dev`. La máquina del taller ejecuta el build de producción;
  desarrolle en la máquina en la que desarrolla.
