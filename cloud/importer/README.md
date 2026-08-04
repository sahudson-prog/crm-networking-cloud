# Cloud importer

Esta carpeta contiene herramientas transicionales para preparar el import del ZIP espejo local hacia Supabase/Postgres.

## Estado

- `preview_export.py`: implementado. Lee un ZIP espejo y muestra solo conteos/validaciones, sin imprimir datos personales.
- `load_export.py`: implementado con modo seguro. Por defecto corre en dry-run; solo escribe con `--apply`.
- Carga real a Supabase: pendiente de ejecutar con un usuario Supabase Auth existente y `CRM_NETWORKING_DATABASE_URL` configurado localmente.

## Uso preview

```powershell
venv\Scripts\python.exe cloud\importer\preview_export.py "C:\ruta\crm-networking-export-YYYYMMDD-HHMMSS.zip" --pretty
```

El preview revisa:

- version del contrato;
- archivos requeridos;
- hashes declarados en `manifest.json`;
- errores bloqueantes y advertencias;
- conteos de tablas origen;
- estimacion de filas destino por tabla cloud.

No escribe en Supabase, no toca Google Sheets y no muestra nombres, correos, telefonos ni minutas.

## Uso dry-run de carga

```powershell
venv\Scripts\python.exe cloud\importer\load_export.py "C:\ruta\crm-networking-export-YYYYMMDD-HHMMSS.zip" --user-id "UUID_DEL_USUARIO_SUPABASE" --pretty
```

El dry-run transforma el ZIP a las tablas destino y muestra conteos planeados, pero no conecta ni escribe en Supabase.

## Preparar carga real

1. Instalar dependencia opcional:

```powershell
venv\Scripts\python.exe -m pip install -r cloud\importer\requirements.txt
```

2. Crear un usuario en Supabase Auth o iniciar sesion con tu usuario.
3. Copiar el UUID del usuario desde Supabase Auth.
4. Crear un archivo `.env` local, no versionado, con la conexion Postgres:

```powershell
CRM_NETWORKING_DATABASE_URL="postgresql://..."
```

Nota: si la conexion directa usa un host tipo `db.xxxxx.supabase.co` y tu red resuelve solo IPv6, puede fallar desde Windows aunque Supabase este bien. En ese caso usa la connection string de **Transaction pooler** o **Session pooler** desde Supabase > Project Settings > Database > Connection string.

5. Cargar esa variable en PowerShell antes de ejecutar:

```powershell
$env:CRM_NETWORKING_DATABASE_URL="postgresql://..."
```

6. Ejecutar carga real solo si el dry-run esta correcto:

```powershell
venv\Scripts\python.exe cloud\importer\load_export.py "C:\ruta\crm-networking-export-YYYYMMDD-HHMMSS.zip" --user-id "UUID_DEL_USUARIO_SUPABASE" --apply --pretty
```

La carga aborta si el usuario destino ya tiene datos en tablas privadas, para evitar pisar informacion.
