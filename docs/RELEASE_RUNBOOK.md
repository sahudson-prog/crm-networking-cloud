# Runbook de releases

## Propósito

Este documento es el owner operativo del flujo feature -> DEV -> Pull Request -> PROD -> sincronización local de Coffeecito. `docs/ACTIVE_PLAN.md` define qué se ejecuta; `docs/PROD_CONTRACTS.md` gobierna compatibilidad persistente; `docs/ENVIRONMENTS.md` define los ambientes.

## Repositorio canónico

- Coffeecito mantiene un único clone local canónico activo. GitHub es la fuente durable de verdad.
- El checkout canónico de `main` permanece limpio, reservado a `main` y no recibe implementación de features.
- Cada feature usa un `git worktree` temporal y recreable, creado desde `origin/main` recién actualizado. No se crean clones independientes adicionales para features.
- Repositorios históricos o de recovery no se usan para planificar ni implementar.
- Si aparecen varios repositorios independientes aparentemente activos, `STOP`: identificar el canónico antes de continuar.

## Preflight de una tarea

Desde canonical `main`, antes de validar un baseline basado en `main`:

```text
git fetch origin main --prune
git remote -v
git rev-parse origin/main
git status --short --branch
```

Verificar el remote, el SHA real de `origin/main`, la limpieza de canonical `main`, el baseline esperado cuando exista y la branch/worktree de la tarea. `origin/main` es una referencia local y no consulta GitHub en tiempo real.

El fetch es read-only respecto del remoto. No autoriza `pull`, merge, rebase, push ni otros efectos externos.

## Feature worktree

- Crear branch y worktree desde `origin/main` recién fetched, sin tracking accidental de `origin/main`.
- La branch obtiene upstream de su propia remote branch únicamente al publicarla.
- Canonical `main` no recibe cambios de la feature directamente.
- Antes de implementar, leer `AGENTS.md`, `docs/ACTIVE_PLAN.md` y solo los owner docs directamente relevantes.
- Código, schema, tests y configuración prevalecen ante documentación desactualizada.

## Desarrollo local y DEV

- Confirmar explícitamente que todo runtime local usa DEV; no inferir el ambiente por ruta, branch o nombre.
- `.env.local` no se versiona. PROD secrets no se copian a DEV ni Preview.
- Validar localmente de forma proporcional al cambio.
- SQL remoto DEV y toda escritura en servicios externos requieren autorización explícita.

## Cambios persistentes

Si un cambio afecta schema, migrations, RLS, Auth, OAuth o contratos persistentes, seguir `docs/PROD_CONTRACTS.md` y los owner docs correspondientes.

- Una migration aplicada no se reescribe; toda evolución posterior es incremental.
- DEV y PROD son ambientes separados. Nunca reemplazar PROD por DEV.
- Definir compatibilidad, backup, rollback y mantenimiento según el riesgo del contrato.

## Backup lógico y ensayo de recuperación PROD

Este procedimiento describe los scripts operacionales existentes `New-ProdLogicalBackup.ps1` y `Test-ProdLogicalRestore.ps1`, mantenidos fuera de Git. La instalación local actual se identifica en su `README.md`; no se recrean scripts ni credenciales desde fragmentos de este documento. Su ubicación convencional es `../local-ops/obj02-pr47/` respecto del clone canónico, pero los comandos permiten seleccionar la ubicación aprobada sin rutas personales. Un clone nuevo no contiene esos scripts: si faltan, STOP y recuperar/revisar el procedimiento antes de ejecutar.

Es reutilizable para futuras releases del mismo PROD, previa revisión del contrato, cambios del servidor y vigencia de los scripts. Sus nombres de carpeta/backup conservan `obj02-pr47`, pero no prueban por sí solos el alcance de una nueva release. No repetir una captura o restauración ya acreditada por una actualización documental. Un backup antiguo tampoco demuestra cobertura de escrituras posteriores.

### Requisitos y autorización

1. Autorizar separadamente la lectura remota para el backup y el ensayo local con datos reales. Ninguno autoriza migrations, merge, deployment ni recuperación sobre PROD.
2. Usar Windows y PowerShell 7.6 validado, o una versión comprobada con `X509CertificateLoader.LoadCertificateFromFile`. El `#requires -Version 7.0` de los scripts no certifica por sí solo esa API. Docker Desktop debe estar accesible con motor Linux local; los binarios PostgreSQL provienen de la imagen, sin necesitar `pg_dump`/`psql` ni Supabase CLI en el host.
3. Disponer localmente de `public.ecr.aws/supabase/postgres:17.11.0.004`. La captura registra el digest de registro; restore exige coincidencia y usa después el ID local inmutable. No se descarga ninguna imagen automáticamente. Un fallo de permisos o del motor Docker no prueba que falte la imagen: comprobar el acceso, no cambiar versiones para esquivar el gate.
4. Confirmar el proyecto en [ENVIRONMENTS.md](ENVIRONMENTS.md). Los scripts están fijados a PROD `ppowxoglqspwvsgyxlft`, Session Pooler `aws-0-sa-east-1.pooler.supabase.com:5432`, base `postgres` y usuario `postgres.ppowxoglqspwvsgyxlft`. Ni el host compartido ni `current_database()` identifican solos el tenant. Otro ambiente requiere procedimiento revisado, no introducir una URL alternativa al ejecutar.
5. Obtener la CA pública oficial del proyecto confirmado en Database Settings > SSL Configuration y conservarla fuera de Git en `$env:LOCALAPPDATA/Coffeecito/Certificates/PROD/supabase-prod-root.crt`. El script valida un único PEM X.509 público, condición CA, vigencia, tamaño, ausencia de enlace y hash del montaje Docker read-only. La procedencia de la descarga se verifica manualmente; la validación sintáctica no la autentica.
6. Mantener TLS `verify-full` para ambos volcados y sesión `default_transaction_read_only=on`. La contraseña se solicita una sola vez, oculta, y se transmite por stdin para uso transitorio dentro del contenedor; no va en argumentos, manifiesto, `.env` ni archivo persistente. No utilizar transcripciones, grabación de terminal ni copiar credenciales a comandos. Administradores del host/Docker siguen siendo parte de la frontera de confianza.
7. Comprobar espacio para archivo comprimido y restauración expandida, tanto en el host como en Docker. La captura solo impone un piso de 4 GiB en su volumen: no estima el tamaño de la base ni la capacidad del disco de Docker. Confirmar protección/cifrado de ambos almacenamientos; el script restringe ACL de la carpeta de backup, pero no certifica cifrado ni seguridad física.
8. El rol de captura debe poder leer todos los objetos necesarios, incluido Auth y globals. Cualquier error de permisos, objeto requerido ausente o dump parcial es STOP; no modificar permisos remotos ni ignorar objetos como parte del backup.
9. Coordinar una ventana sin cambios de schema, roles o ACL: el dump de base y el de globals son secuenciales, no comparten un único snapshot. Documentar qué escrituras posteriores requerirían conciliación. No asumir consistencia entre sistemas externos y el dump por compartir una fecha.

### Captura manual

Ejecutar en PowerShell 7 únicamente después de autorizar el backup. El primer dato es la ubicación local del procedimiento aprobado, no una confirmación del proyecto ni una credencial. El script de captura pide solo la contraseña oculta:

```powershell
$ErrorActionPreference = 'Stop'
$OpsDir = (Resolve-Path -LiteralPath (Read-Host 'Directorio local de los scripts operacionales aprobados')).Path
$BackupScript = Join-Path $OpsDir 'New-ProdLogicalBackup.ps1'
if (-not (Test-Path -LiteralPath $BackupScript -PathType Leaf)) { throw 'Falta el script aprobado. STOP.' }
& pwsh -NoProfile -File $BackupScript
if ($LASTEXITCODE -ne 0) { throw 'Captura fallida. Preservar la carpeta incompleta; no ejecutar restore.' }
```

El script crea una carpeta nueva `obj02-pr47-<UTC>` bajo `$env:LOCALAPPDATA/Coffeecito/Backups/PROD`, fuera de Git. No sobrescribe carpetas existentes. `INCOMPLETE` permanece hasta terminar ambos volcados, validar archivos no vacíos, TOC, roles esperados y publicar el manifiesto mediante un archivo provisional. Un fallo temprano puede dejar una carpeta sin manifiesto; tampoco es un backup válido.

`BACKUP CAPTURE PASS` exige salida correcta de `pg_dump` y `pg_dumpall`, archivos `database.dump` y `globals.sql`, tamaños/SHA-256 y manifiesto consistente. El TOC debe incluir datos de `auth.users` y `public.contacts`; globals debe contener los roles Supabase esperados. El manifiesto registra proyecto, UTC, versión fuente, imagen/digest, hash de CA y presencia de metadata Storage. No imprime filas ni contraseñas. Un manifiesto y hashes verifican integridad accidental, no autenticidad si un atacante reemplaza ambos. **CAPTURE PASS no equivale a recuperación PASS.**

### Restore local con selección explícita

Usar la ruta exacta mostrada por la captura aprobada; no elegir un respaldo viejo para evitar un error del nuevo. El parámetro `-BackupDirectory` debe resolver dentro de la raíz privada de backups PROD. Este bloque no conecta a Supabase:

```powershell
$ErrorActionPreference = 'Stop'
$OpsDir = (Resolve-Path -LiteralPath (Read-Host 'Directorio local de los scripts operacionales aprobados')).Path
$RestoreScript = Join-Path $OpsDir 'Test-ProdLogicalRestore.ps1'
if (-not (Test-Path -LiteralPath $RestoreScript -PathType Leaf)) { throw 'Falta el script aprobado. STOP.' }
$BackupDirectory = (Resolve-Path -LiteralPath (Read-Host 'Ruta exacta de la captura autorizada que reportó BACKUP CAPTURE PASS')).Path
& pwsh -NoProfile -File $RestoreScript -BackupDirectory $BackupDirectory
if ($LASTEXITCODE -ne 0) { throw 'Restore fallido. STOP; preservar backup y contenedor diagnóstico.' }
```

El script muestra la carpeta y exige `RESTORE LOCAL`, no solicita la contraseña de PROD. Si se omite `-BackupDirectory`, selecciona la carpeta `obj02-pr47-*` más reciente por nombre y se detiene si está incompleta: no retrocede silenciosamente a otra. Se prefiere siempre la selección explícita para gates de release.

La ejecución actual comprueba identidad/proyecto/imagen, tamaños, SHA-256, TOC y versión fuente antes de restaurar. Usa un contenedor nuevo sin red, sin puertos publicados, socket Unix y backup montado read-only. La restauración estricta:

1. Inicializa `supabase_admin` como rol bootstrap y crea un administrador auxiliar solo local. Una copia privada temporal de globals reemplaza exactamente el CREATE duplicado del bootstrap por una aserción; conserva ALTER ROLE, membresías y otorgantes. Un contrato incompatible detiene el ensayo.
2. Carga el soporte mínimo Supautils y `wal_level=logical`, sin los scripts globales de extensiones de la imagen que podrían añadir ACL ajenas al dump. Divide el TOC sin omitir ni duplicar entradas y aborta ante dependencias de event triggers no clasificadas.
3. Recrea base, propiedades, schema, datos, owners, ACL, RLS y extensiones bajo el contexto de `supabase_admin`; después crea event triggers/anotaciones bajo sus propietarios originales mediante `--use-set-session-authorization`. No eleva `postgres` a SUPERUSER ni usa `--no-owner`, `--no-acl` o continuación tras errores.
4. Comprueba que `auth.users` y `public.contacts` existen y contienen filas. No es una comparación exhaustiva de todas las filas, privilegios o catálogos contra PROD. Las comparaciones exactas de fixtures sintéticas son evidencia de tests distinta del ensayo real.
5. Verifica la identidad del contenedor propio, su etiqueta `coffeecito.restore.run` y aislamiento; elimina solo el contenedor exitoso y sus volúmenes anónimos, y emite `RESTORE GATE PASS`. Si falla, conserva el contenedor detenido con logs internos privados. Un fallo de limpieza también es STOP.

### Cobertura, protección y límites

- El dump incluye schema/datos accesibles, Auth, large objects, propiedades de base, definiciones de extensiones, propietarios y ACL; globals incluye roles, membresías y tablespaces, sin contraseñas de roles. Tablespaces o dependencias incompatibles detienen el replay. La imagen debe contener los binarios requeridos; los archivos binarios de extensiones no viajan dentro de `pg_dump`.
- Storage schema/metadata puede estar incluido, pero **Storage object bytes no**. Auth/OAuth externo, redirects, secretos/claves de cifrado, configuración Supabase/Vercel/proveedores y PITR no están cubiertos. Los valores cifrados de DB pueden existir en el dump sin las claves externas necesarias para utilizarlos.
- No hay inventario independiente de versiones/propietarios originales de todas las extensiones ni comparación remota exhaustiva. `RESTORE GATE PASS` certifica el replay y controles descritos, no una réplica completa del proyecto. Determinar cobertura adicional según los objetos realmente afectados; una release que no altera Storage ni configuración externa no obliga por ello a restaurarlos, pero una recuperación total sí exige contemplarlos.
- Backups, globals, archivos parciales, logs y clústeres detenidos pueden contener PII/secretos. Nunca adjuntarlos a Git, PRs o chats. Compartir solo fase, código de salida, categoría, SQLSTATE y container ID sanitizados. Mantener almacenamiento privado/protegido; Docker administrators pueden acceder a él.
- No existe retención automática ni un plazo universal aprobado. El owner decide la retención según ventana de recuperación, escrituras posteriores y minimización de datos. No eliminar la última copia requerida hasta validar su sustituta. No reutilizar carpetas fallidas ni modificar la captura certificada.
- La limpieza automática del contenedor exitoso es parte del ensayo autorizado. Cualquier limpieza de backups, fallos, contenedores diagnósticos o volúmenes anteriores requiere autorización explícita e identificación exacta. No ejecutar `prune`, borrados por prefijo ni limpiezas generales. Eliminar un recurso no garantiza borrado seguro del disco Docker.

## SQL PROD manual por archivo

1. Acordar proyecto, SHA, manifest ordenado de archivos y condiciones STOP. Comprobar dependencias y SQL ya aplicado; no repetir migrations/verifiers acreditados salvo evidencia que invalide el resultado. Usar el archivo original versionado, no SQL reconstruido desde el chat, bootstrap o reparaciones DEV.
2. Ejecutar primero preflight read-only y, cuando corresponda, captura; revisar todos sus resultados. Antes de DDL, cerrar el gate de backup/recuperación y compatibilidad de runtime. Un STOP o drift impide avanzar.
3. Cada migration necesita su autorización separada. Copiar un archivo ya identificado no exige otra confirmación trivial; la autorización relevante es ejecutar SQL en el proyecto real. El agente no abre ni opera SQL Editor automáticamente.
4. Para copiar cualquier archivo aprobado (preflight, captura, migration o verifier), ejecutar el bloque completo siguiente. Pedir rutas es selección de archivo, no autorización de ejecución. En el equipo concreto, el agente debe entregar el mismo bloque con rutas ya resueltas cuando se conozcan, nunca fragmentos que el owner deba recomponer.

```powershell
$ErrorActionPreference = 'Stop'
$Repo = (Resolve-Path -LiteralPath (Read-Host 'Ruta del repositorio o worktree aprobado que contiene el SQL')).Path
$RelativeSql = Read-Host 'Ruta relativa exacta del SQL aprobado dentro de cloud/supabase'
$SqlFile = [IO.Path]::GetFullPath((Join-Path $Repo $RelativeSql))
$SqlRoot = [IO.Path]::GetFullPath((Join-Path $Repo 'cloud/supabase')).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $SqlFile.StartsWith($SqlRoot, [StringComparison]::OrdinalIgnoreCase) -or
    [IO.Path]::GetExtension($SqlFile) -ine '.sql' -or
    -not (Test-Path -LiteralPath $SqlFile -PathType Leaf)) { throw 'Ruta SQL no válida. STOP.' }
$SqlText = Get-Content -LiteralPath $SqlFile -Raw -Encoding utf8
if ([string]::IsNullOrWhiteSpace($SqlText)) { throw 'SQL vacío. STOP.' }
Get-FileHash -LiteralPath $SqlFile -Algorithm SHA256
Set-Clipboard -Value $SqlText
Write-Host "SQL completo copiado desde: $SqlFile. No ejecutado."
```

5. El owner confirma visualmente el project ref de PROD en SQL Editor, pega el contenido completo, contrasta archivo/hash con el manifest aprobado y ejecuta solo ese gate. No seleccionar un fragmento de una transacción. Revisar resultados/errores completos sin publicar filas sensibles; no avanzar ante STOP/error ni asumir éxito por una ejecución parcial.
6. Tras cada migration, copiar y ejecutar su verifier correspondiente; exigir el resultado contratado antes de autorizar el siguiente archivo. Ejecutar los verificadores compuestos/canónicos que exija la release al final. Registrar evidencia mínima de proyecto, archivo/hash y PASS/FAIL en el checkpoint, sin diarios ni duplicar dumps.
7. Crear PR y autorizar merge son gates separados. SQL/verifiers PASS no autorizan merge; merge no prueba deployment. Verificar después el SHA efectivo, Production Ready/Current, dominio y smoke requerido. No inferir smoke PASS de tests locales ni de Vercel Ready.

## Recuperación ante fallo

- Preflight fallido: STOP sin migrations. Fallo de una migration transaccional antes de COMMIT: verificar rollback y mantener el runtime compatible; no reejecutar a ciegas.
- Después de COMMIT: conservar schema/datos, detener o limitar escritores según el contrato aprobado y revisar compatibilidad. Preferir rollback de runtime compatible o forward-fix. Un runtime anterior incompatible no es recuperación válida.
- No volcar automáticamente el backup pre-cutover sobre PROD. Una restauración coordinada exige autorización independiente, ventana de mantenimiento, preservación del estado posterior al incidente, evaluación/reconciliación de escrituras posteriores al backup, Auth, Storage, contraseñas de roles y configuración externa. Acordar pérdida de datos aceptable; no asumir PITR.
- El fallo de restore local mantiene el gate de recuperación en NO-GO. Diagnosticar desde el contenedor detenido, sin repetir extracciones ni restauraciones reales innecesariamente. Resolver con pruebas sintéticas y autorizar un nuevo ensayo explícitamente.

## Commit y publicación de branch

Commit y push requieren autorización explícita.

Al publicar una feature:

- stagear únicamente el alcance aprobado;
- hacer push a la propia branch;
- configurar upstream de esa misma branch, nunca de `origin/main`;
- `STOP` después del push y reportar SHA, archivos y validaciones.

Codex no crea Pull Requests.

## Pull Request y merge

- El usuario crea el Pull Request manualmente desde GitHub Web.
- Codex entrega repository, base y head verificados, título, descripción y archivos, commits y checks a revisar.
- Crear el PR y hacer merge son gates distintos.
- El usuario realiza personalmente el merge desde GitHub Web.
- Después del merge, verificar el SHA realmente integrado en `main`.
- Un merge Git no demuestra un deployment exitoso.

## Deployment PROD

Para Vercel Production:

- verificar el deployment real;
- confirmar el commit/SHA asociado;
- exigir estado exitoso;
- ejecutar el smoke PROD correspondiente.

Para cambios de base de datos, seguir el orden aprobado para la release. Cuando aplique:

```text
preflight/captura -> backup/recuperación -> autorización por migration -> migration -> verifier focal -> verifier compuesto/canónico -> autorización de merge -> merge manual -> deployment efectivo -> smoke
```

No ejecutar SQL PROD sin autorización explícita.

## Sincronización local post-release

Después de merge, deployment y smoke requerido —o `N/A` explícitamente justificado—, desde canonical `main` limpio:

```text
git fetch origin main --prune
git merge --ff-only origin/main
git status --short --branch
```

Verificar:

- `HEAD = main = origin/main`;
- working tree limpio;
- migrations, docs y assets mergeados presentes físicamente en canonical `main`.

Si canonical `main` está sucio o el avance no es fast-forward, `STOP`. No usar reset ni rebase para corregirlo.

Deployment Ready/Current sin smoke requerido PASS no cierra la release ni autoriza esta sincronización. Con autorización explícita puede hacerse solo fetch y preparar documentación en un worktree desde el SHA integrado, dejando canonical intacto y el checkpoint IN PROGRESS. No confundir ese fetch con el fast-forward post-release.

## Ciclo de vida de worktrees

Un feature worktree es temporal. Puede retirarse únicamente después de:

- confirmar el merge;
- sincronizar canonical `main`;
- revisar cambios y archivos locales o ignorados relevantes;
- obtener autorización explícita para la limpieza.

No es obligatorio retirar worktrees en cada release.

## Paths operacionales

- La documentación versionada usa paths relativos al repositorio, nunca paths personales de Windows, macOS o Linux.
- Después del merge, SQL e instrucciones manuales se referencian desde canonical repo, no desde worktrees temporales.
- Antes del merge puede usarse un worktree para validar la feature que contiene.

## Recuperación de un PC

GitHub reconstruye código, documentación, migrations, verifiers, tests e historial. Los worktrees se recrean.

Secrets y `.env.local` no se reconstruyen desde Git: deben recuperarse desde fuentes seguras, dashboards o password manager. Supabase, Vercel, Google y Cloudflare son servicios externos al PC. Backup y restauración de datos PROD son un problema separado del clone local.

## Condiciones de STOP

Detenerse ante:

- baseline remoto inesperado;
- canonical `main` sucio cuando debe usarse o sincronizarse;
- múltiples repositorios aparentemente activos sin canonical claro;
- conflicto o avance no fast-forward;
- migration aplicada modificada;
- ambiente DEV/PROD ambiguo;
- secreto detectado;
- deployment no confirmado;
- smoke fallido;
- contradicción material entre el repositorio, `docs/ACTIVE_PLAN.md` y los owner docs.
