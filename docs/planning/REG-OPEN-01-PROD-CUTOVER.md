# REG-OPEN-01: publicacion controlada

## Estado y decision

Paquete preparado desde `codex/reg-open-01`, baseline remoto verificado
`dddb6b10410d1f07ac72ed5e27fdb10787ddb2b0` (PR #61). Canonical main limpio.
No hay commit, push, PR, merge ni operaciones PROD de esta iniciativa.
ACTIVE_PLAN conserva un checkpoint historico INT-01; no describe este candidato.
Esta instruccion vigente del owner y Git identifican REG-OPEN como trabajo actual;
no se reabre aquel pipeline ni se interpreta el texto antiguo como permiso operativo.

Clasificacion **RED / PROD CONTRACT CHANGE**. GO condicionado para preparar y
publicar la branch solo con autorizacion posterior; NO-GO para ejecutar SQL,
merge/deploy o abrir altas hasta cerrar los gates independientes indicados abajo.

Evidencia conservada: PostgreSQL aislado, variantes estandar y DEV multi-tester,
121 checks DEV / 119 estandar del single-switch, pruebas frontend, typecheck y
build aprobados. Los cuatro SQL incrementales DEV pasaron segun el owner.
Smoke real DEV: ON/OFF persistido, CTA y mensaje lateral, acceso admin existente
y bloqueo de Mantencion anonima PASS. DEV termino OFF. Registro nuevo Google/email,
asignacion real free/user, onboarding nuevo y acceso de ese usuario tras OFF:
**NOT TESTED**. El owner decide trasladar esa cobertura a PROD, no declararla PASS.
La denegacion remota de una identidad bloqueada/no-admin autenticada tampoco se
certifico en ese smoke. Las pruebas sinteticas de esas reglas siguen siendo otra evidencia.

Validacion nueva de este paquete: 16 checks PASS del contexto PROD en PostgreSQL
local sin red (antes/despues de la cadena, OFF, variante/modo, ACL, seguridad,
rollback y ausencia de escrituras del control). Copiador en ValidateOnly PASS y
hashes de los nueve SQL distintos coincidentes. No se repitieron suites frontend,
build, typecheck ni smoke aprobados; no cambio codigo de producto.

## Compatibilidad esperada, no certificacion remota

- PROD esperado: proyecto `ppowxoglqspwvsgyxlft`, R2-B estandar en `open`, sin
  columna DEV `additional_test_user_ids`; Calendar 001-005 ya instalado segun owner.
  Ambos escritores server-side (contact request y finalize Google) conservan
  EXECUTE de service_role en open. No trasladar la excepcion DEV test_only a PROD.
- Instalar **202611190001 y despues 202611200002**, ambas originales. La primera
  crea settings OFF, ledger privado, captura Auth y adapta hook/bootstrap/acceso;
  la segunda reemplaza solo tres funciones conservando firmas, OIDs y ACL.
  No editar/reaplicar lo ya instalado en DEV, ni ejecutar semillas/bootstrap completos.
- Los preflights validan cuerpos completos normalizados, firmas, owner,
  search_path, ACL e herencia. El incremental comprueba ademas anchors unicos con
  normalizacion CRLF conocida. Drift desconocido o instalacion parcial: STOP.
- Hook conserva `hook_enforce_app_access_allowlist(jsonb)` y permiso exclusivo
  supabase_auth_admin. El trigger de perfiles no cambia; se agrega captura privada
  ordenada despues del perfil. No hay backfill de usuarios pendientes.
- Runtime actual y anterior consumen `bootstrap_current_user_invitation_v1()` y
  `current_user_app_access_status()` con sus firmas conservadas. OFF conserva las
  admisiones completadas. Invitaciones/allowlist siguen independientes; no se
  modifican sus interruptores, cupos ni estados.
- `paused` sigue siendo parada global. No usarlo como paso rutinario de este cutover:
  cambiarlo altera otras operaciones y grants. Mantener R2-B sin cambios.
- Calendar no se modifica. Finalize server-side sigue exigiendo sesion, acceso,
  rollout, capabilities y gate admin Calendar; login Google no es conectar Calendar.
  El SQL no certifica por si solo la ruta desplegada ni el dashboard Auth.

## Gates antes de SQL y merge

1. Owner autoriza separadamente publicacion Git, lectura preflight PROD,
   backup/restore y cada migration. El paquete por si solo no los autoriza.
2. Confirmar en SQL Editor el project ref PROD, no solo nombre de base/host.
   Ejecutar pasos 1-2 read-only y entregar PASS o error sanitizado. Un contexto
   distinto del esperado no se repara abriendo R2-B, cambiando ACL o editando hashes.
3. Cerrar backup recuperable y restore local conforme a RELEASE_RUNBOOK. El ultimo
   respaldo acreditado en ACTIVE_PLAN (`obj02-pr47-20261112-182947Z`) no cubre
   escrituras posteriores. No hay dispensa de este gate para REG-OPEN. Scripts
   existentes: `../local-ops/obj02-pr47/New-ProdLogicalBackup.ps1` y
   `Test-ProdLogicalRestore.ps1`, fuera de Git. No ejecutarlos automaticamente.
4. Coordinar ventana breve sin altas/bootstrap en curso ni cambios administrativos
   de acceso/invitaciones/roles. Los locks y lock_timeout no sustituyen drenaje.
   No improvisar cambios de dashboards/gate para lograrlo; si no puede coordinarse,
   STOP y acordar el procedimiento antes del SQL. No interrumpir runtimes DEV.
5. Certificar sin copiar secretos: Hook Before User Created habilitado y apuntando
   a la funcion prevista; proveedor Google PROD y callback Supabase correctos;
   retorno `https://coffeecito.cl/auth/callback`; verificacion email; CAPTCHA Auth
   server-side y site key PROD para OTP; entrega de email y limites Auth efectivos.
   Las confirmaciones historicas de ENVIRONMENTS no son evidencia fresca del signup.
   Google Testing/audiencia puede limitar identidades: certificar disponibilidad
   real sin asumir que la aprobacion Coffeecito equivale a autorizacion Google.
6. Revisar capacidad y monitoreo de abuso para una apertura publica. Google login
   no tiene CAPTCHA propio en este candidato; no desactivar protecciones para el
   smoke. Email visible implica cobertura pendiente si solo se prueba Google.

## SQL manual: orden exacto

El manifiesto versionado
`cloud/supabase/operations/prod/reg_open_prod_release_manifest.json` contiene rutas
relativas y SHA-256 de cada archivo. Todos son read-only salvo pasos 3 y 6.

| Paso | Archivo bajo cloud/supabase | Condicion para continuar |
| --- | --- | --- |
| 1 | operations/prod/202611200003_check_reg_open_prod_context.sql | PASS, standard/open, not_installed |
| 2 | preflight/202611190001_preflight_public_registration_v1.sql | PASS, sin objetos REG-OPEN previos |
| Gate | Backup/restore, drenaje, autorizacion migration inicial | Acreditados por owner |
| 3 | migrations/202611190001_public_registration_v1.sql | Transaccion completa confirmada, OFF |
| 4 | verifiers/202611190001_verify_public_registration_v1.sql | PASS del contrato intermedio |
| 5 | preflight/202611200002_preflight_public_registration_single_switch.sql | PASS y OFF |
| Gate | Autorizacion migration incremental | Acreditada por owner |
| 6 | migrations/202611200002_public_registration_single_switch.sql | Transaccion completa confirmada |
| 7 | verifiers/202611200002_verify_public_registration_single_switch.sql | PASS contrato definitivo |
| 8 | verifiers/202610270002_verify_networking_cycle_operations_v1.sql | PASS R2-B estandar/open |
| 9 | verifiers/202611060005_verify_calendar_write_boundary.sql | PASS frontera Calendar |
| 10 | operations/prod/202611200003_check_reg_open_prod_context.sql | PASS, OFF, mismo R2-B y grants |

Los pasos 8-9 comprueban compatibilidad del acceso central corregido con los
contratos protegidos; no reinstalan R2-B/Calendar. No ejecutar los verifiers
DEV/Calendar 202611200001/002 en PROD. No ejecutar verifier inicial REG-OPEN
despues del incremental: certifica un cuerpo ya sustituido.

Usar `Copy-RegOpenProdSql.ps1 -Step N`: valida hashes de todo el paquete y copia
solo el archivo elegido. No conecta a Supabase ni ejecuta SQL. El owner pega el
archivo completo en SQL Editor, confirma proyecto/rol postgres y ejecuta solo ese
paso autorizado. Un error, timeout, resultado desconocido o hash diferente es STOP.
No encadenar ejecuciones ni marcar PASS porque el editor muestre un resultado parcial.

Si la instalacion inicial ya existiera en PROD, NO saltar automaticamente a 002:
detenerse y reconciliar evidencia. Tras un fallo de migration, comprobar rollback
antes de reintentar. Si 001 confirmo y 002 falla, conservar 001/OFF y diagnosticar;
no repetir 001. Tras COMMIT los verifiers no revierten la migration.

## Git, PR y deployment

Propuesta: un commit atomico `feat(auth): add controlled public registration (REG-OPEN-01)`.
Repository `sahudson-prog/crm-networking-cloud`; base `main`; head `codex/reg-open-01`.
Titulo PR: `REG-OPEN-01: registro libre configurable y admision persistente`.

Descripcion propuesta:

> Switch unico admin.manage_access, lectura publica minima y fail-closed, CTA ON/OFF.
> Admision verificada persistente free/user; OFF no revoca altas completadas.
> Invitaciones, bloqueos, R2-B paused, ownership, RLS y Calendar preservados.
> RED: requiere cadena SQL 202611190001 -> 202611200002, backup/recuperacion y
> verifiers PROD PASS antes del merge. Se entrega OFF.
> DEV: migrations/verifiers y switch/landing real PASS. Registro nuevo Google/email
> NOT TESTED por decision del owner; smoke trasladado a PROD, riesgo explicitamente abierto.
> Recuperacion: OFF y forward-fix; rollback de runtime compatible no revierte SQL.
> Cutover y manifiesto: docs/planning/REG-OPEN-01-PROD-CUTOVER.md.

Incluir exclusivamente:
- 6 archivos de producto: AdminMaintenancePage, AuthGate, PublicLanding,
  PublicRegistrationAdminPanel, PublicRegistrationStatus y lib/publicRegistration.
- 2 migrations y 2 preflights REG-OPEN; 4 verifiers REG-OPEN (incluidos los DEV
  historicos requeridos por tests), 2 diagnosticos DEV de solo lectura.
- 3 archivos de este paquete PROD: contexto read-only, manifiesto y copiador.
- 5 archivos PostgreSQL de tests/fixture y 4 frontend de tests/harness.
- 5 owner docs modificados: DATA_MODEL, PRODUCT, PROD_CONTRACTS, SECURITY_ACCESS,
  connectors/GOOGLE; este plan de cutover.

Total propuesto: **34 archivos**, sin staging realizado. Los SQL de diagnostico
DEV/fixtures se versionan como evidencia/herramientas; NO pertenecen al orden PROD.
Excluir .env.local, secrets, node_modules, .next, AGENTS generado, capturas, logs,
datasets y local-ops. Los dos verifiers historicos R2-B/Calendar del manifiesto ya
estan en main y no son nuevos cambios Git. Revisar inventario real antes de commit.

Inventario selectivo exacto (no ejecutar staging sin autorizacion):

```text
cloud/web/components/AdminMaintenancePage.tsx
cloud/web/components/AuthGate.tsx
cloud/web/components/PublicLanding.tsx
cloud/web/components/PublicRegistrationAdminPanel.tsx
cloud/web/components/PublicRegistrationStatus.tsx
cloud/web/lib/publicRegistration.ts
cloud/web/tests/local/public-registration-browser.cjs
cloud/web/tests/local/public-registration-preview.cjs
cloud/web/tests/publicRegistration.test.cjs
cloud/web/tests/publicRegistrationRefresh.test.cjs
cloud/supabase/migrations/202611190001_public_registration_v1.sql
cloud/supabase/migrations/202611200002_public_registration_single_switch.sql
cloud/supabase/preflight/202611190001_preflight_public_registration_v1.sql
cloud/supabase/preflight/202611200002_preflight_public_registration_single_switch.sql
cloud/supabase/verifiers/202611190001_verify_public_registration_v1.sql
cloud/supabase/verifiers/202611200001_verify_reg_open_dev_calendar.sql
cloud/supabase/verifiers/202611200002_verify_public_registration_single_switch.sql
cloud/supabase/verifiers/202611200002_verify_reg_open_dev_calendar.sql
cloud/supabase/operations/dev/202611190001_diagnose_reg_open_contract.sql
cloud/supabase/operations/dev/202611200002_diagnose_failed_single_switch.sql
cloud/supabase/operations/prod/202611200003_check_reg_open_prod_context.sql
cloud/supabase/operations/prod/Copy-RegOpenProdSql.ps1
cloud/supabase/operations/prod/reg_open_prod_release_manifest.json
cloud/supabase/tests/local/fixtures/reg_open_r2b_dev_multitester.sql
cloud/supabase/tests/local/public_registration_single_switch.mjs
cloud/supabase/tests/local/public_registration_v1_postgres.mjs
cloud/supabase/tests/local/reg_open_dev_calendar_verifier.mjs
cloud/supabase/tests/local/reg_open_prod_context.mjs
docs/DATA_MODEL.md
docs/PRODUCT.md
docs/PROD_CONTRACTS.md
docs/SECURITY_ACCESS.md
docs/connectors/GOOGLE.md
docs/planning/REG-OPEN-01-PROD-CUTOVER.md
```

Orden: autorizacion commit/push -> owner crea PR (sin merge) -> preflights,
backup y SQL autorizado/verifiers -> autorizacion merge -> owner merge -> Vercel
Production Ready/Current del SHA integrado -> smoke OFF -> gate temporal de signup
-> OFF final -> decision separada de apertura publica sostenida.
Main dispara deployment: NO merge antes del gate SQL. No usar Preview con PROD ni
promover el build local DEV. El build PROD usa su configuracion Production vigente.

## Smoke PROD y restriccion de apertura

**Incompatibilidad operativa a resolver antes del smoke nuevo:** no se puede probar
una admision realmente nueva sin invitacion mientras el switch permanezca OFF.
ON es global, no limitado a la cuenta de prueba. No existe un modo de prueba privado
ni un cupo especial en este contrato. No prometer cero exposicion durante el smoke.
Se requiere aprobacion explicita de una ventana breve ON antes de completarlo,
sin anunciar apertura, y luego OFF. Si el owner exige no abrir a terceros en ningun
momento antes de PASS, el registro nuevo debe probarse en DEV o cambiarse el alcance;
esa condicion implica NO-GO para un smoke nuevo exclusivamente PROD.

1. OFF tras deployment: admin y usuario existente autorizado conservan acceso;
   recargar Mantencion confirma OFF. Portada anonima: CTA invitacion y mensaje
   lateral; ingreso existente y enlaces legales correctos. No modificar sus datos.
2. Antes de ON: owner identifica expresamente cuenta Google nueva, inexistente en
   Auth y no allowlisted/invitada. Alias y resultados bastan para evidencia; no
   publicar email/token/UUID. Owner realiza login y consentimiento. Identidades
   bloqueadas/no-admin para rechazos deben estar tambien autorizadas; no alterar
   usuarios existentes para fabricar el escenario. Email requiere otra autorizacion
   e inbox controlado; si se omite, registrar NOT TESTED y decidir el riesgo.
3. Ventana ON autorizada: admin guarda y confirma tras recarga. Landing real:
   Crear mi cuenta + flecha, sin mensaje lateral. Nueva cuenta Google completa
   verificacion del proveedor, aceptacion legal y onboarding. Confirmar acceso
   free/user mediante superficie administrativa existente, sin asignar roles manualmente.
   No conectar Contacts/Gmail/Calendar ni otorgar permisos adicionales.
4. Tan pronto la admision este confirmada, OFF mediante Mantencion; comprobar
   estado persistido y portada cerrada. La cuenta nueva sigue accediendo tras
   recarga/nuevo login. Legal/onboarding deben conservar estado real.
5. No-admin no ve/puede modificar el control; bloqueados/revocados autorizados
   siguen denegados. No elevar roles ni usar service role para simular la prueba.
   Rechazo de alta nueva OFF solo con otra identidad autorizada si se prueba por
   Auth real; una portada cerrada no demuestra ese rechazo backend.
6. Registrar PASS/FAIL/NOT TESTED por caso, SHA servido, horario ON/OFF y evidencia
   no sensible. Un FAIL restaura OFF, detiene apertura y activa diagnostico focal.
   NOT TESTED de seguridad/acceso no se declara PASS por pruebas locales.

## Recuperacion

Admin autorizado abre Sistema -> Mantencion, Consultar estado; si ON, desmarca,
Guardar registro libre, confirma y recarga. Esperar confirmacion persistida OFF;
verificar landing no basta para acreditar cierre. Respuesta incierta: Consultar
estado y reconciliar, no repetir escrituras a ciegas ni usar SQL ad hoc.

OFF detiene nuevas admisiones, no revoca cuentas completadas ni elimina sus datos.
Puede detener una identidad aun pendiente antes de terminar el bootstrap; no
presentarla como admitida. Revisar incidentes individualmente con autorizacion.
Si admin RPC/runtime no permiten cerrar: STOP/incident, escalar al owner para una
accion operacional especifica. No afirmar OFF ni abrir R2-B como solucion.
Siempre que sea posible cerrar antes de rollback al deployment anterior, que no
ofrece switch. Mantener SQL expandido y ledger/auditoria; forward-fix revisado.
No restaurar funciones antiguas, borrar admisiones ni restaurar backup masivamente.
Preservar y conciliar escrituras posteriores a cualquier respaldo.

## Riesgos residuales y siguiente autorizacion

Registro nuevo end-to-end no probado; configuracion real Auth/antiabuso y estado
PROD SQL sin certificar; ventana ON global requiere decision; email requiere
cobertura o aceptacion explicita; legal/onboarding siguen gates UI, no nueva RLS.
Locks de primera admision pueden competir con escritores administrativos; un
deadlock revierte la operacion afectada y exige relectura, no reintento ciego.

Siguiente gate propuesto: revision del inventario/PR y autorizacion separada de
commit/push, preflights PROD y backup/recuperacion. No hay autorizacion operativa
implicita en este documento. Conservar DEV OFF y runtimes existentes.
