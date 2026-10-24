# SEC-GOOGLE-01 expand: operación PROD

Operación manual y separada para promover exclusivamente
`202610210001_google_sync_capability_enforcement_v1.sql`. No ejecuta bootstrap,
no aplica `202610210002` y no incorpora reparaciones DEV.

## Frontera de recuperación

La captura y el recovery SQL protegen el estado lógico que modifica expand:

- cuatro capabilities y sus grants iniciales a `beta_tester`;
- seis funciones, incluida la definición previa de
  `finalize_google_connected_account_verified(uuid,text,text[])`;
- ACL de las funciones y de `connected_accounts`.

El recovery generado exige que las seis funciones conserven definición, owner,
ACL, `SECURITY DEFINER`, `search_path` y propiedades de ejecución esperadas tras
expand. También protege owner, RLS, FORCE RLS y ACL de `connected_accounts`.
Restaura ese catálogo sin borrar `connected_accounts`,
contactos, interacciones, mappings, snapshots ni cursores escritos después de
expand. Falla si aparecen grants de rol/plan u overrides nuevos para las cuatro
capabilities, si una función cambió o si el ACL de `connected_accounts` difiere
de la captura. Esas situaciones requieren revisión manual: no se resuelven con
`CASCADE`, un restore parcial ni edición improvisada del SQL.

Esto no sustituye un backup recuperable ni PITR. Backup/PITR cubre corrupción o
fallo amplio de base y puede implicar restaurar un ambiente completo y perder
escrituras posteriores al punto elegido. El recovery SQL revierte solo expand y
preserva las escrituras posteriores enumeradas arriba; no recupera datos
eliminados o alterados por otros procesos.

## Gate 1: preflight y captura read-only

Confirmar manualmente que el SQL Editor corresponde al proyecto PROD
`ppowxoglqspwvsgyxlft`; `current_database()` no identifica un proyecto Supabase.
Después, con rol `postgres`, ejecutar y exportar resultados completos:

1. `cloud/supabase/preflight/202610210001_preflight_google_sync_rollout_v1.sql`.
2. `cloud/supabase/operations/prod/202610240001_capture_sec_google_01_expand.sql`.

El primer archivo entrega los siete bloques agregados de población, conexiones,
roles, overrides y delta. No reutilizar recuentos históricos ni inferir cohorte
por plan o por Connected Account. `cohort_population_reconciliation.is_reconciled`
debe ser `true`; toda excepción, override o cambio de cohorte requiere revisión.

La captura devuelve una sola celda JSON sin identificadores de usuario, emails ni
tokens. Descargarla sin truncamiento, guardar el contenido exacto fuera del repo
y registrar el SHA-256 del archivo. Su `stop_reasons` debe ser `[]`. Si no lo es,
STOP: expand no debe corregir drift incidental de PROD.

El recovery certificado requiere que las cuatro capabilities de expand no
existan en la captura previa. Si alguna ya existe, STOP y preparar una estrategia
de recuperación específica para ese estado. El seed versionado describe el
bootstrap posterior a expand y no demuestra el estado real de PROD ni sustituye
esta captura.

Generar un recovery de revisión, todavía no ejecutable:

```text
node cloud/supabase/operations/prod/build-sec-google-01-expand-recovery.mjs \
  --snapshot <capture-json> \
  --output <recovery-draft.sql>
```

El draft falla antes de cualquier cambio. Verificar su manifest, capture MD5,
SHA-256 de la migration, definición previa y assertions. Conservar captura,
hash y draft juntos en almacenamiento operacional autorizado.

## Gate 2: backup y ventana pre-contract

Antes de SQL de escritura:

- confirmar un backup/PITR PROD recuperable, su timestamp y procedimiento de
  restauración; un indicador de backup sin ruta de restore verificada no basta;
- registrar el SHA de aplicación actualmente desplegado;
- obtener aceptación explícita de la ventana pre-contract: los grants legacy de
  provenance permanecen hasta el gate contract separado;
- confirmar que la revocación concurrente aceptada y diferida no cambió de
  alcance;
- confirmar que no se hará backfill ni cambio de roles/planes/usuarios.

Si falta cualquiera de estas evidencias, STOP.

## Gate 3: expand

Ejecutar manualmente, en este orden:

1. `cloud/supabase/migrations/202610210001_google_sync_capability_enforcement_v1.sql`.
2. `cloud/supabase/verifiers/202610210001_verify_google_sync_capability_enforcement_v1.sql`.
3. `cloud/supabase/verifiers/202610210001_verify_google_sync_capability_enforcement_behavior.sql`.
4. `cloud/supabase/verifiers/202610210001_verify_access_expand_pre_contract.sql`.

Los cuatro pasos deben finalizar PASS. No usar los verificadores contract ni
overlays locales reservados. Expand es compatible con el runtime anterior: la
firma previa de finalización se conserva, las nuevas RPC son aditivas y
`connected_accounts` ya era una superficie de escritura RPC-only. El orden
inverso, runtime nuevo antes de expand, no es compatible.

## Gate 4: PR, deployment y smoke

Solo tras expand PASS:

1. merge manual de PR #36;
2. verificar el SHA integrado en `main`;
3. verificar el deployment Vercel Production correspondiente a ese SHA;
4. ejecutar smoke PROD con datos/cuentas de prueba: rol base restringido,
   `beta_tester` habilitado, Contacts, Gmail por etiquetas y Calendar con
   autorización, lectura, preview, aplicación controlada e idempotencia;
5. comprobar que Google Login básico, vCard e ICS conservan sus contratos.

STOP ante deployment distinto, error técnico de capabilities, escritura parcial,
duplicados inesperados o acceso Google del rol base.

## Recovery SQL

No generar un archivo ejecutable hasta que exista autorización explícita de
recovery. En ese caso, a partir de la captura aprobada:

```text
node cloud/supabase/operations/prod/build-sec-google-01-expand-recovery.mjs \
  --snapshot <capture-json> \
  --output <recovery-approved.sql> \
  --approve <payload_md5>
```

Revisar el archivo completo y ejecutarlo como una única transacción. Todas las
precondiciones corren antes del primer cambio permanente; las assertions corren
antes de `COMMIT`. Si aborta, no editarlo ni combinar fragmentos: conservar el
error y volver a diagnóstico.

La guarda de proyecto es operacional y manual: el SQL no intenta deducir el
ambiente desde el nombre de la base. Confirmar nuevamente el project ref PROD
antes de cualquier futura ejecución autorizada.

Si el runtime nuevo ya fue desplegado, redeplegar y verificar primero el SHA de
aplicación anterior mientras expand continúa activo. Solo después ejecutar el
recovery SQL. No retirar expand bajo el runtime nuevo, porque ese orden elimina
RPC que el cliente nuevo necesita.

## Contract

`202610210002` es otro release y otra autorización. Solo puede prepararse después
de runtime nuevo desplegado, instancias antiguas drenadas y smoke PROD PASS. No
forma parte de esta operación ni de su recovery.
