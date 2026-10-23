# SEC-DEV-01 grant reconciliation

Operación manual exclusiva para Supabase DEV. Estos archivos no forman parte de
`cloud/supabase/migrations/`, del bootstrap ni de un pipeline automático. No deben
ejecutarse en PROD.

## Precondiciones

- Confirmar fuera de SQL que el proyecto abierto es DEV.
- Conservar el inventario read-only aprobado que identifica exactamente las 15
  tablas desviadas: `app_capabilities`, `app_role_capabilities`, `app_roles`,
  `headhunter_companies`, `headhunter_company_domains`,
  `organization_memberships`, `organizations`, `profiles`,
  `service_connectors`, `subscription_plan_capabilities`, `subscription_plans`,
  `user_access_profiles`, `user_capability_overrides`,
  `user_plan_sponsorships` y `user_role_assignments`.
- Confirmar que las 15 tablas conservan antes de la operación los ocho grants
  diagnosticados para `anon`, `authenticated` y `service_role`. El script aborta
  si el drift efectivo no coincide con ese manifest nominal.
- Confirmar que SEC-GOOGLE-01 expand está aplicado y contract no está aplicado.
- Ejecutar como `postgres`.
- Detenerse si aparecen objetos, roles, grants o consumidores no incluidos en el
  diagnóstico aprobado.

## Captura de recuperación

1. Ejecutar `202610220000_capture_sec_dev_01_recovery.sql`.
2. Exportar la única celda JSON completa mediante la descarga del resultado. No
   copiar desde una vista truncada del SQL Editor.
3. Guardar el archivo fuera del repositorio y registrar además su hash de archivo
   con `Get-FileHash -Algorithm SHA256`.
4. Validar que `snapshot_version = 3`, `entry_count`, `object_count`, los conteos
   por superficie y los hashes de entradas, objetos y estados de default ACL estén
   presentes. La captura conserva para las seis combinaciones
   `global/public x tables/sequences/functions` tanto la presencia de la fila en
   `pg_default_acl` como todas sus entradas.
5. Ejecutar `New-SecDev01ExactRecovery.ps1` contra la exportación. El generador
   recomputa cada fingerprint, ambos hashes agregados y todos los recuentos antes
   de producir SQL. No ejecuta conexiones ni SQL.
6. Conservar cualquier snapshot v2 existente como evidencia histórica, sin
   sobrescribirlo. V2 no distingue una fila ausente de `pg_default_acl` de una fila
   explícita sin grants para los roles cliente y no sirve para recuperación exacta.
   Antes de una recuperación se necesita una nueva captura read-only v3.
7. Detenerse si `sequence_acl_exception_count` no es cero. Cualquier ACL cliente
   sobre una secuencia `public` es drift nuevo y requiere una decisión separada.
8. Revisar las entradas y el inventario de objetos; no continuar si el set de
   tablas difiere del diagnóstico aprobado.

La captura es read-only, incluye ACL e inventario de las secuencias existentes y
termina en `ROLLBACK`. No contiene datos de usuarios.

Ejemplo local para validar la exportación y generar una recuperación exacta
revisable, sin ejecutarla:

```powershell
./New-SecDev01ExactRecovery.ps1 `
  -SnapshotPath C:\ruta-segura\sec-dev-01-snapshot.json `
  -OutputPath C:\ruta-segura\sec-dev-01-exact-recovery.sql
```

## Remediación

`202610220001_reconcile_sec_dev_01_grants.sql` contiene el manifest nominal
aprobado y es autocontenido: no depende de variables de sesión ni de una ejecución
anterior. Debe ejecutarse completo, sin editar ni separar su transacción. La
operación aborta si faltan objetos, aparece una tabla no clasificada, el drift de
los tres roles no coincide con las 15 tablas o existen privilegios no aprobados
fuera del manifest.

Para `authenticated`, la operación restaura exactamente la matriz canónica en las
15 tablas: `SELECT` en todas; `INSERT` solo en `headhunter_companies`,
`headhunter_company_domains`, `user_access_profiles` y `user_role_assignments`;
`UPDATE` solo en `user_access_profiles` y `user_role_assignments`; ningún `DELETE`,
`TRUNCATE`, `REFERENCES`, `TRIGGER` ni `MAINTAIN`. Para `anon` y `service_role`
retira los ocho privilegios de tabla en las 15.

Después, ejecutar `202610220001_verify_sec_dev_01_grants.sql`, los verificadores
canónicos de acceso y merge/reset compatibles con el estado pre-contract, y los
smokes DEV aprobados para Auth, solicitudes de contacto y Google Sync.

## Fixture local

`testing/202610220001_seed_sec_dev_01_drift.sql` existe exclusivamente para una
base Supabase local vacía y desechable. Reproduce los ocho privilegios excesivos
de `anon`, `authenticated` y `service_role` sobre las 15 tablas, además del drift
de schema, funciones y default ACL de `postgres`. Exige el opt-in de sesión
`coffeecito.sec_dev_01_local_fixture = 'on'` y no forma parte del procedimiento
manual DEV.

`testing/202610230001_seed_sec_dev_01_validator_function_drift.sql` también es
exclusivo de pruebas locales destructivas. Antes de eliminar `public`, exige en
la misma sesión el rol `postgres`, la base exacta
`coffeecito_sec_dev_01_validator_fixture` y el opt-in
`coffeecito.sec_dev_01_local_fixture = 'on'`; si falta cualquiera, aborta antes
del primer cambio.

## Funciones de validación

El diagnóstico acumulativo confirmó dos drifts DEV: el `search_path` de
`validate_contact_sync_storage_v0_1()` y el cuerpo más `search_path` de
`validate_headhunter_company_master_v0_1()`. La reparación autorizada es
`202610230001_repair_sec_dev_01_validator_functions.sql`; valida de forma
fail-closed el manifest de tablas, índices, cuerpos, owner y ACL antes de cambiar
ambas funciones y vuelve a comprobarlos antes de `COMMIT`.

`202610230002_recover_sec_dev_01_validator_functions.sql` restaura únicamente
las dos definiciones DEV capturadas antes de esa reparación y exige como
precondición el estado reparado esperado. Usarlo solo como recuperación
específica revisada. **No usar**
`202610220004_repair_sec_dev_01_function_search_paths.sql`: quedó obsoleto por
una normalización incorrecta de finales de línea y fue retirado del paquete.

## Recuperación

Existen dos modalidades distintas:

- **Restauración exacta del ACL administrado:** usar exclusivamente el SQL completo
  generado desde un snapshot v3 validado. Ese SQL verifica el inventario nominal,
  limpia los grants administrados objeto por objeto, reproduce todas las entradas
  y restaura la presencia o ausencia original de cada fila de default ACL. Antes
  de `COMMIT` compara dentro de la misma transacción la matriz ACL, las seis filas
  virtuales de default ACL y todas sus entradas; cualquier diferencia provoca
  excepción y rollback. Debe revisarse íntegramente y requiere autorización
  expresa antes de ejecutarse.
- **Recuperación selectiva:** no está automatizada. Ante una dependencia legítima
  inesperada, detenerse y preparar un artefacto nominal nuevo para el objeto, rol y
  privilegio mínimos aprobados. No editar, extraer ni combinar manualmente líneas
  `recovery_sql` del JSON o del script exacto.

Para una restauración exacta:

1. Detener el rollout y registrar el objeto, rol y operación fallida.
2. Confirmar nuevamente que el proyecto abierto es DEV y que el inventario actual
   coincide con el snapshot. El SQL generado aborta si difiere.
3. Revisar y ejecutar el archivo generado completo, sin editar ni concatenar
   fragmentos.
4. Aunque las assertions transaccionales hayan pasado, repetir inmediatamente la
   captura read-only v3 y comparar todos los conteos y hashes con el snapshot
   original como defensa en profundidad.
5. Repetir los verificadores y el smoke relacionado.

No ejecutar una restauración exacta global salvo decisión explícita de emergencia.
Si aparece drift de secuencias o cualquier diferencia de inventario, STOP: el
generador no producirá el artefacto. La recuperación no modifica datos de producto
ni reemplaza una corrección forward-only cuando el contrato compartido deba cambiar.
