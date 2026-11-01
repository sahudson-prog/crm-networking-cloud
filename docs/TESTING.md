# Testing y validación

## Propósito

Este documento describe las herramientas y rutas de validación disponibles hoy para la aplicación cloud de CRM Networking. Su foco es la práctica real de pruebas observada en el repositorio: comandos disponibles, cobertura automatizada existente, verificaciones manuales necesarias y deuda conocida.

AGENTS.md contiene la regla transversal de validar proporcionalmente al riesgo y alcance. Este documento identifica qué herramientas concretas existen para hacerlo.

## Alcance actual

La infraestructura de pruebas vigente vive en `cloud/web`.

El stack validado es:

- Next.js, React y TypeScript.
- Supabase como backend y base de datos.
- Tests automatizados con el runner nativo de Node.js (`node --test`).
- Archivos TypeScript ejecutados con flags de Node para strip de tipos.

No existe un comando global `npm test` ni cobertura formal completa. Sí hay harnesses focales de navegador y PostgreSQL local, descritos por módulo; no equivalen a CI integral ni a smoke remoto.

### Seguimiento V1

- Desde cloud/web: `node --experimental-strip-types --test tests/trackingModel.test.ts tests/trackingCoffeeContract.test.ts`. Cubre estado actual elegible, transición de ingreso/reingreso, cita calendar pasada, llamada excluida, horizonte semanal/mensual IANA/DST, exclusión por cancelación/descarte, filtros/HH, falta de fecha atribuible, métricas vigentes y paginación. No certifica propagación externa de cancelaciones.
- Desde la raíz: `node --experimental-strip-types cloud/supabase/tests/local/tracking_snapshot_postgres.mjs`. Requiere imagen Supabase PostgreSQL 17 existente; no descarga, usa red none, sin puertos, datos sintéticos y cleanup por identidad/label. Aplica 002→003 localmente y prueba guardas/rollback, ACL/RLS efectivos, aislamiento, revocación y más de 2.600 interacciones con/sin columna opcional. Ejecuta el cálculo sobre el snapshot real con estado/transición, citas locales sin status, cancelación y descarte; mide tiempo PostgreSQL sintético, no latencia DEV.
- Desde cloud/web: `node --test tests/dashboardComposition.test.mjs` verifica lectores de detalle con límite API inferior al solicitado, fallos explícitos y compatibilidad del gráfico KPI original sin series apiladas.
- Desde cloud/web: `node tests/local/tracking-browser.cjs`, con `OPPORTUNITY_PLAYWRIGHT_MODULE` apuntando a Playwright ya disponible. Monta ReadOnlyDashboard, sus secciones y Shell reales; sustituye proveedores de sesión/lectura por fixtures y bloquea red externa. Comprueba tabla reutilizada, barras apiladas sin línea, total por columna, tooltips hover/foco/Escape, búsqueda de detalle sin alterar métricas, latencia/error/retry/desmontaje/filtros y escritorio/320px; guarda capturas fuera de Git.
- `node tests/local/status-boards-browser.cjs` conserva la regresión montada de Contactos/Objetivos/Oportunidades. `npm run typecheck` y `node tests/local/opportunities-build.cjs` verifican tipos y build estándar aislado con fuente local; sin .env real. Smoke autenticado y volumen/latencia reales por ambiente quedan pendientes.

## Comandos confirmados

Ejecutar desde `cloud/web`.

```powershell
npm run typecheck
```

Valida TypeScript con `tsc --noEmit`.

```powershell
npm run build
```

Valida que Next.js pueda compilar la aplicación.

```powershell
npm run test:kpis
```

Ejecuta pruebas de cálculos KPI.

```powershell
npm run test:rules
```

Ejecuta pruebas del motor de reglas Coach.

```powershell
npm run test:headhunter-master
```

Ejecuta pruebas del maestro de empresas headhunter.

```powershell
npm run test:logs
```

Ejecuta pruebas de logs y diagnósticos de lectura de interacciones externas.

```powershell
npm run test:system-access
```

Ejecuta pruebas de la matriz de capabilities y guards de las superficies de Sistema.

```powershell
npm run test:google-adapter
```

Ejecuta pruebas de adapters/clientes/flujos Google para contactos e interacciones.

```powershell
npm run test:sync
```

Ejecuta la suite más amplia de sincronización, incluyendo preview, aplicación, cursores, normalización de teléfonos, merge y revisión de duplicados.

## Cobertura automatizada observada

Los tests actuales cubren principalmente lógica pura o flujos aislados en TypeScript.

Áreas con cobertura observada:

- Cálculo de KPIs y periodos.
- Métricas de objetivos.
- Motor de reglas Coach.
- Maestro de empresas headhunter.
- Normalización e identidad de teléfonos.
- Preview y aplicación de sincronización de contactos.
- Merge de contactos y revisión de duplicados locales.
- Orquestación de sincronización y cursores.
- Google Contacts: adapter, cliente y flujo de preview.
- Gmail y Calendar: adapters, clientes y flujo de sincronización.
- Logs de sincronización y sanitización de datos sensibles.
- Diagnósticos de lectura de interacciones externas.

El archivo `tests/objectiveMetrics.test.ts` existe, pero no se observó incluido en un script npm dedicado. Hasta que se cablee explícitamente, debe tratarse como cobertura existente pero no integrada al flujo estándar.

## Qué validar según el tipo de cambio

Para cambios pequeños en lógica cubierta por tests, ejecutar primero el script específico correspondiente.

Para cambios de tipos, contratos compartidos, imports o estructura de componentes, ejecutar `npm run typecheck`.

Para cambios en rutas Next.js, server/client components, configuración de build, dependencias o estructura transversal, ejecutar `npm run build`.

Para cambios de sincronización de contactos, ejecutar al menos `npm run test:sync`. Si el cambio toca adapters o clientes Google, agregar `npm run test:google-adapter`.

Para cambios en Coach, ejecutar `npm run test:rules`.

Para cambios en KPIs, existe `npm run test:kpis`. Para métricas de objetivos existe `tests/objectiveMetrics.test.ts`, pero no se observó un script npm dedicado que lo integre al flujo estándar.

Para cambios de UI, además de typecheck o build cuando corresponda, realizar revisión manual en navegador. La revisión debe verificar que la vista renderiza, que las acciones principales siguen disponibles y que los estados de carga, vacío y error no rompen el layout.

Para cambios en navegación, guards o superficies administrativas de Sistema, ejecutar `npm run test:system-access`. La cobertura comprueba la matriz de capabilities, el fail-closed y la presencia de `AuthGate` y del guard antes de los componentes privados.

Para cambios de SQL, RLS, permisos o funciones Supabase, revisar la migration o script afectado y usar los verificadores SQL existentes cuando apliquen. No hay evidencia de una suite SQL automatizada integrada al flujo npm.

OBJ-02 R2-A añade `node --test cloud/supabase/tests/networking_cycles_history_v1.test.mjs` para composición estática y `node cloud/supabase/tests/local/networking_cycles_history_v1_postgres.mjs` para certificación PostgreSQL 17 desechable, sin red ni puertos. El harness cubre migration, verifiers, backfill sin historia inventada, RLS/grants, revocación, concurrencia, rollback y reset; no sustituye preflight ni smoke remotos.

OBJ-02 R2-B y el forward-fix Google: desde `cloud/web` ejecutar `npm run test:networking-cycles`, `npm run test:sync` y `node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/googleConnectedAccountVerification.test.ts`; desde la raíz ejecutar `node cloud/supabase/tests/local/networking_cycle_operations_v1_postgres.mjs`. El harness PostgreSQL instala migrations `202610270001`, `202610270002` y `202610280001` en orden sobre baseline desechable; prueba preflight/verifiers, roles y grants reales, contexto sin ciclo, sync estado/foco, merge histórico, concurrencia, rollback e idempotencia. No sustituye el smoke autenticado ni los gates de DEV/PROD.

Oportunidades 004: desde `cloud/web`, `node --test tests/opportunityUi.test.mjs tests/opportunityDiagnostics.test.mjs` y `node --experimental-strip-types --test tests/opportunityModel.test.ts`. `node tests/local/opportunities-browser.cjs` monta el editor React real con transporte sintético; requiere Playwright existente (opcional `OPPORTUNITY_PLAYWRIGHT_MODULE`) y Edge, bloquea tráfico externo y cierra su servidor temporal. Cubre alta sin relaciones, contacto/Prioridad con lectura de Interacciones fallida, edición conservadora, confirmación de desvinculación, reintentos, respuestas tardías y 320px. No certifica sesiones DEV/PROD.

`node tests/local/status-boards-browser.cjs` monta ambos tableros con adaptadores sintéticos y la misma restricción de red. Compara Contactos contra su versión de HEAD (texto, geometría y estilos en escritorio/320px), verifica grupos HH, arrastre real y menú con teclado, placeholder/línea azul, debounce de 1,6 segundos, cambios durante guardado, versiones confirmadas, rechazo y respuestas tardías. Conserva capturas sintéticas en una carpeta temporal identificada al finalizar; elimina solo su bundle/servidor propios. No requiere SQL ni una sesión real.

Desde la raíz, ejecutar `node cloud/supabase/tests/local/opportunities_v1_postgres.mjs` y la variante `--without-soft-delete`. Usan imágenes locales PostgreSQL 17/PostgREST, sin descargas, red externa ni puertos publicados; prueban cadena 002/003/004, drift fail-closed, verifiers, roles efectivos, acciones frontend contra HTTP real, 401 filas con límite API 100, metadata, ownership, concurrencia de descarte/participantes, merge y rollback. La imagen aislada requiere un adaptador de claims exclusivamente sintético; no modifica el contrato Auth productivo ni certifica Auth remoto.

`npm run typecheck` valida el candidato. `node tests/local/opportunities-build.cjs` ejecuta `npm run build` estándar/Turbopack en una copia temporal sin `.env`, con dependencias existentes, configuración sintética y fuente local de prueba para evitar Google Fonts. Conserva el worktree; no certifica descarga/entrega externa de fuentes. Los harness eliminan solo sus recursos identificados. El smoke autenticado y los gates SQL por ambiente siguen separados.

Para reproducir el reset observado en DEV antes de R2-A, ejecutar el mismo harness con `R2A_RESET_VARIANT=hardened-standalone-crlf`. Esta variante instala localmente el cuerpo exacto del script independiente con CRLF y metadata/ACL endurecidas, comprueba su admisión, bloquea cuerpos o permisos alterados y verifica que R2-A lo sustituye por el reset completo.

La prueba montada `status-boards-browser.cjs` también usa latencia controlada y reloj virtual para comprobar carga inicial conjunta de Objetivos, fuentes opcionales pendientes, ausencia de desmontajes/atenuación al reconciliar, éxito de 1,8 segundos, errores persistentes, limpieza de timers, reintento de lectura sin repetir escrituras y respuestas tardías. Monta la página real y su panel de ciclo con adaptadores sintéticos; conserva cobertura desktop/320px y del tutorial sin Oportunidades.

La fase de cierre de Oportunidades se certifica con `node cloud/supabase/tests/local/opportunities_v1_postgres.mjs --closure` y `--closure --without-soft-delete`. Reutiliza el fixture aislado y la cadena 002/003/004 antes de 202610300001; comprueba STOP por etapas legacy ambiguas, drift y rollback, los 18 pares etapa/resultado, causas, reapertura en la misma etapa, versiones concurrentes, roles efectivos, métricas vigentes, HTTP real, merge, ciclo histórico y reset. Sin `--closure`, el harness conserva las pruebas SQL de la fase histórica 002/003/004; el HTTP del runtime vigente se prueba solo con la fase nueva instalada. Los harness de editor/tableros cubren cuatro columnas, filtro, cierre/reapertura confirmados y las regresiones de fluidez, latencia, timers y 320px. No se conectan a DEV/PROD.

## Comprobación manual necesaria

La comprobación manual sigue siendo necesaria cuando el comportamiento depende de:

- Sesión real de usuario.
- OAuth o permisos de proveedor conectado.
- Supabase remoto o datos reales.
- Confirmaciones antes de guardar cambios.
- Vistas complejas de sincronización, contactos, dashboard, objetivos, cuenta o sistema.
- Estados visuales responsivos desktop/mobile.
- Operaciones destructivas o de alto impacto.

## Triage de incidentes funcionales

Antes de ampliar una auditoría de código ante un fallo reproducible:

1. Reproducir el flujo en el navegador.
2. Revisar Console y la excepción capturada.
3. Revisar Network sin exponer tokens, credenciales ni payloads sensibles.
4. Determinar si el fallo ocurre antes del proveedor, durante la llamada al proveedor o durante Apply.
5. Auditar después el tramo de código identificado por esa evidencia.

## CI y automatización

No se observó carpeta `.github` ni workflow de GitHub Actions en el repositorio. Por lo tanto, no debe asumirse que las validaciones corren automáticamente al hacer commit o push.

Hasta que exista CI, cada cambio relevante debe declarar qué validación se ejecutó y qué quedó sin validar.

## Gaps conocidos

- No existe comando global `npm test`.
- No existe lint script observado.
- No existe suite E2E o de navegador observada.
- No existe prueba visual automatizada observada.
- No existe reporte de cobertura observado.
- No existe harness automatizado de SQL/RLS observado.
- `objectiveMetrics.test.ts` no aparece integrado en scripts npm.
- No hay evidencia de CI activo.
