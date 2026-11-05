# UX-DATE-01 - Una fecha visible para networking y ciclo

## Estado y alcance

Candidato local implementado desde `e0092dbb8b4b8530ad0fdc66a9690a76322ec9b4`, sin commit. Integración local Beta UX V1 junto con BRAND-BETA-01 y UX-ONB-COPY-01; no es una release independiente. El owner confirma SQL/verifiers 001/002 y smoke funcional DEV PASS, con DEV nuevamente paused y Data API OFF; PROD sin cambios UX-DATE. No se verificó remotamente ese estado durante la integración. El contrato recuperado de `ux-date-01-contract` se conserva en ese worktree.

## Contrato aprobado

- Una sola fecha visible: inicio del ciclo en Objetivos. Se retira `Fecha_Inicio_Networking` del tutorial y Cuenta; no cambia la secuencia V1 ni se reinicia completed, in_progress o replay.
- Selector de inicio solo de fecha; cierre con fecha/hora hasta minutos, sin segundos visibles. La conversion de inicio conserva las RPC de instantes: primer instante valido del dia en zona IANA, ajustado al mayor limite aplicable (politica para nuevos ciclos y cierre anterior). Si la medianoche no existe por DST, usa el primer instante valido; si se repite, el primer instante permitido por los limites. Rechaza dias inexistentes o sin instante elegible anterior al presente. No reescribe timestamps existentes ni limita la excepcion legacy.
- Los procesos pueden ser consecutivos el mismo dia: el siguiente inicio puede igualar el cierre anterior; una fraccion de segundo se redondea hacia arriba solo en el nuevo valor representable por el adaptador. El cierre debe ser estrictamente posterior al inicio, nunca futuro; su selector ofrece el primer minuto valido y conserva la eleccion explicita ante horas repetidas. Validacion de entrada manual y errores junto al campo antes de enviar; DB sigue siendo autoridad.
- El inicio conocido del ciclo, su fecha civil y su zona quedan inmutables en DB. Un ciclo nuevo admite hasta M meses calendario atrás, inicialmente seis. Mantención permite enteros 1–12 bajo `admin.manage_access`, incluidos denies y acceso efectivo.
- Un ciclo legacy sin inicio admite completar una vez su fecha real, incluso anterior a M; después es inmutable. No se infiere desde Auth, fechas importadas ni la clave antigua.
- Todo inicio conocido debe ser finito, también al completar legacy o actualizar fechas civiles. Preflight y migration 001 rechazan datos existentes infinitos sin exponerlos ni repararlos; la comprobación de instalación queda serializada con escritores de ciclos.
- Para todos los usuarios: `límite histórico = máximo(inicio del ciclo activo, comienzo del día local de hoy menos M meses calendario)`. La zona IANA es la del ciclo, no la del navegador ni UTC. Ajuste de fin de mes por calendario; medianoche inexistente se desplaza hacia adelante y una ambigua usa offset estándar según PostgreSQL. El cálculo es DB y se entrega como instante, sin mover fechas persistidas.
- Sin ciclo activo con inicio conocido, las nuevas importaciones históricas de interacciones se bloquean. No bloquea contactos ni cambia el sync periódico/incremental vigente.
- Una clave legacy más restrictiva NO agrega límite individual, confirmación especial, preferencia de transición ni excepción. La ventana nueva puede incluir más historia que antes, siempre dentro de la fórmula común. No se importa automáticamente.
- Se conservan interacciones, ciclos anteriores y cursores. La clave antigua permanece internamente para compatibilidad periódica; no se sincroniza físicamente con el ciclo, no se borra y no gobierna importaciones históricas nuevas.
- Aclaración expresa del owner: es una regla de las operaciones históricas del producto. Se preserva la ruta incremental autorizada; no se exige que el servidor pruebe la procedencia Google de un lote presentado como periódico. No se añade un backend OAuth/proxy para ello.

## Copy aprobado

- Ciclo nuevo: "Puedes elegir una fecha de hasta X meses atrás."
- Importación histórica: "Traeremos tus correos y citas desde el inicio de tu proceso, con un máximo de X meses hacia atrás."
- X proviene de la política server-side. En configuración legacy se explica que el inicio real puede superar ese límite, que solo limita la importación.

## Implementación y fronteras

- `networking_history_policy`: singleton global, M, revision, updated_at y updated_by; sin acceso directo cliente. Lectura estrecha para usuarios admitidos; edición administrativa con revisión esperada y bloqueo de fila.
- `current_user_history_window_v1()` devuelve ciclo, contexto R2-B, revisión, M, zona y límite efectivo. No acepta identidad del cliente. Review conserva el contexto; Apply vuelve a leer y SQL lo comprueba bajo lock de ciclo y política. Un cambio de ciclo, revisión o día efectivo exige nueva revisión.
- `apply_ics_import_v2(jsonb,jsonb)` aplica un lote atómico con el writer ICS existente y límite por instante; sustituye únicamente su gate civil UTC obsoleto. Conserva límites, foco, participantes, ownership, deduplicación y concurrencia del writer original.
- `apply_google_history_v1(uuid,jsonb,jsonb)` valida cada ítem con el mismo contexto; `apply_google_periodic_v1(uuid,jsonb)` delega sin ventana histórica al writer Google existente. Conserva scopes, capability, ownership y cuenta conectada; no relaja esos controles.
- Google mantiene atomicidad por ítem, no por lote completo: si cambia el contexto entre ítems, algunos anteriores pueden quedar aplicados. No avanzar cursor ante fallo; nueva revisión y deduplicación permiten reintentar sin borrar datos. ICS revierte el lote completo ante rechazo.
- Las entradas antiguas Google/ICS pierden EXECUTE de cliente al instalar la segunda migration. El núcleo Google no se reemplaza. No se cambian las ventanas rolling, historyId, syncToken ni lógica de recuperación periódica.
- Nombre y situación profesional siguen usando las RPC R1. El cliente envía `p_networking_start_date = null`; no altera el valor legacy ni inicia sync al guardar.
- Las métricas de Seguimiento conservan su snapshot y lógica de ciclos; no se modifican SQL, cálculos ni atribuciones de Seguimiento. Las lecturas legacy internas permanecen para consumidores compatibles.

## PROD CONTRACT CHANGE y artefactos

Artefactos preservados byte a byte desde el candidato DATE aplicado en DEV según el owner; su presencia local no certifica instalación PROD.

1. `cloud/supabase/preflight/202611040001_preflight_networking_history_policy_v1.sql`
2. `cloud/supabase/migrations/202611040001_networking_history_policy_v1.sql`
3. `cloud/supabase/verifiers/202611040001_verify_networking_history_policy_v1.sql`
4. `cloud/supabase/preflight/202611040002_preflight_history_import_context_v1.sql`
5. `cloud/supabase/migrations/202611040002_history_import_context_v1.sql`
6. `cloud/supabase/verifiers/202611040002_verify_history_import_context_v1.sql`

Preflights read-only, sin PII; objetos homónimos, dependencias ausentes, fechas infinitas o drift detienen la instalación antes del primer DDL. La segunda migration exige cuerpos exactos ICS/Google, owner y search_path. Los verifiers certifican columnas/defaults/nulabilidad, constraints validados, FK, singleton, RLS, owner, ACL de tabla/columnas/funciones y propiedades de seguridad de entradas y helpers privados, además de sus cuerpos. No son reparadores ni reinstaladores. No reejecutar migrations previas. Los checks legacy que exigían EXECUTE cliente sobre V1 o el límite ICS antiguo quedan sustituidos por los nuevos verifiers, no deben forzarse a PASS.

## Compatibilidad y recuperación

- Fase 001 es expansión sin backfill: agrega política y guarda de inicio. Puede rechazar una creación antigua que exceda M; ningún dato existente se reescribe.
- Fase 002 exige gate R2-B con una sola fila, paused y sin tester. El preflight informa STOP con open/test_only; la migration vuelve a comprobarlo bajo bloqueo de tabla mantenido hasta COMMIT, impidiendo una reapertura concurrente durante el DDL. La pausa no cancela solicitudes previamente admitidas: el operador debe detener nuevas solicitudes, cerrar sesiones viejas y comprobar drenaje de transacciones antes de autorizar SQL. No matar sesiones automáticamente.
- Mantener paused después de SQL/verifiers hasta disponer del runtime nuevo; pasar a test_only para una cuenta de prueba, ejecutar smoke autorizado y pasar a open solo después de PASS. Verificar también los permisos service_role que administra el gate existente. El runtime previo ya no puede escribir Google/ICS por V1. No usarlo como rollback funcional tras 002.
- Antes de COMMIT: rollback transaccional. Después: conservar schema/datos, pausar operaciones afectadas y usar forward-fix o runtime nuevo probado compatible. No reabrir V1 ni restaurar datos globales improvisadamente.
- DEV: decidir respaldo adicional según datos irremplazables. PROD: backup recuperable y ventana aprobados independientemente, sin asumir PITR. Se mantiene el procedimiento de RELEASE_RUNBOOK/PROD_CONTRACTS.

## Validación y gates

- Harness `cloud/supabase/tests/local/networking_history_policy_postgres.mjs`: PostgreSQL 17 Supabase desechable, sin red/puertos, datos sintéticos; cadena completa, preflights/verifiers, rollback, ACL/RLS, calendario/DST, legacy, inmutabilidad, aislamiento, reintentos ICS, separación periódica y concurrencia de política.
- Tests de onboarding V1, ciclos/horas ambiguas, sync/cursor, Google, ICS y política. Fixture `cloud/web/tests/local/history-policy-browser.cjs`: componentes y adaptadores reales, transporte sintético, Edge a 320 px y desktop, rutas históricas/periódicas, contexto obsoleto, fecha retirada y ausencia de overflow. No equivale a smoke autenticado.
- Hardening local: pruebas negativas de fechas infinitas, rollback/reintento legacy, catálogo/ACL/helpers alterados y gate open/test_only; prueba de dos sesiones que acredita bloqueo de reapertura hasta COMMIT. Cuenta distingue ciclo ausente/incompleto de error técnico, bloquea imports durante carga/error y permite reintentar solo la lectura; el harness cubre recuperación, respuestas tardías y desmontaje sin escrituras.
- Evidencia reportada por el owner: SQL/verifiers y smoke funcional individual DEV PASS. Pendiente: revisión y smoke de integración Beta UX V1, cubriendo first-run/in_progress/completed/replay, ciclos, Cuenta y Mantención, además de los importadores afectados según permisos ya autorizados. No reinstalar SQL DEV ni pedir nuevos scopes.
- Después, integrar con los dos candidatos publicados sin reemplazar su copy/branding y repetir regresiones conjuntas. Revisar y autorizar SQL, merge y deployment PROD como gates separados. No presentar UX-DATE-01 como release completada.
- No quedan decisiones funcionales abiertas sobre excepciones legacy o rango administrativo. El smoke funcional individual DEV está aprobado por el owner; siguen pendientes el smoke del conjunto integrado y la promoción PROD.

## Gate de release conjunta Beta UX V1

Antes de publicar: verificar main remoto con autorización de red, revisar el diff conjunto y smoke integrado DEV con tester autorizado; no repetir migrations DEV ya verificadas. PROD es PROD CONTRACT CHANGE, con backup recuperable y ventana autorizada. No ejecutar merge antes de completar SQL: main puede desplegar automáticamente en Vercel.

Orden propuesto PROD: inventario/preflight 001, captura y backup/restore gate; pausa R2-B sin tester, bloqueo de escritores auxiliares y drenaje comprobado; autorización 001 -> migration 001 -> verifier 001; preflight 002 -> autorización 002 -> migration 002 -> verifier 002. Mantener paused hasta merge manual autorizado, deployment del SHA integrado y Production Ready/Current comprobados. Luego test_only con runtime nuevo, smoke aprobado y apertura separadamente autorizada. Si se desactiva Data API durante la pausa, restaurarla solo para la prueba controlada, manteniendo escritores auxiliares bloqueados.

Runtime anterior + 001 conserva operaciones salvo inicios fuera de política o intentos de cambiar inicios conocidos; runtime nuevo requiere 001/002 para sus wrappers. Tras 002 el anterior no puede escribir Google/ICS. Fallo antes de COMMIT: rollback transaccional; después: mantener paused, preservar datos y forward-fix/runtime compatible. No rollback a RPC V1 ni restauración global automática. Riesgo residual Google de modo periódico declarado por cliente permanece aceptado.
