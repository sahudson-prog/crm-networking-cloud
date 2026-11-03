# UX-SAVE-01 - Persistencia transversal

## Estado y objetivo

- Status: `PLANNED / NOT CONTRACTED` para implementación; quinta en el orden beta. Arquitectura preliminar, sin tecnología elegida.
- Evaluar una capa reutilizable entre UI y escrituras, para funciones presentes y futuras, no solo tarjetas.

## Garantías distintas

1. Continuar guardando al navegar dentro de la aplicación.
2. Completar una operación ya aceptada durablemente por el servidor sin depender del navegador.
3. Recuperar pendientes locales tras recargar, cerrar y reabrir el navegador.

Ninguna opción promete envío garantizado si el navegador se cierra offline y nunca vuelve a ejecutarse.

## Requisitos y alternativas para evaluar

- UI optimista inmediata; cola independiente del ciclo de vida de las vistas; estados globales de guardado, errores explícitos, reintentos y conciliación.
- Persistencia local mínima y protegida cuando proceda; recepción durable en servidor solo donde el contrato exija procesamiento independiente del navegador.
- Consolidar operaciones repetidas únicamente cuando sea semánticamente seguro; mensajes de mutación mínimos, idempotencia y control de versiones.
- Resolver concurrencia entre pestañas, sesiones y dispositivos; no imponer sesión única sin evidencia.
- Mantener autorización vigente, RLS, ownership, ciclos y auditoría; no guardar secretos ni PII innecesaria en colas locales.
- Comparar infraestructura actual, TanStack Query con persistencia de mutaciones, Dexie/IndexedDB, Supabase Queues/pgmq y Background Sync/Workbox; no seleccionar una por anticipado.

## Pendientes, dependencias y gates

- Auditar primero las escrituras reales, RPCs, tiempos, errores, desmontajes y concurrencia. Decidir por operación entre escritura directa y procesamiento durable asíncrono.
- Hipótesis: un piloto en Contactos y Oportunidades permitirá distinguir qué garantías requieren infraestructura compartida y cuáles ya cubre el runtime.
- Excluye reemplazo masivo de escritores, promesa de sincronización offline universal y cambio de contratos persistentes sin aprobación.
- Gate: pruebas de navegación, recarga/cierre, offline/reintento, versiones, idempotencia, autorización y múltiples pestañas/dispositivos. Un backend durable nuevo exige `PROD CONTRACT CHANGE`, migration/verifiers y recuperación.
- Owner docs: `docs/ARCHITECTURE.md`, `docs/SECURITY_ACCESS.md`, `docs/PROD_CONTRACTS.md`, `docs/TESTING.md`, `docs/PRIVACY_COMPLIANCE.md`.
