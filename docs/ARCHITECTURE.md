# Arquitectura

## Propósito

Este documento describe la arquitectura vigente de CRM Networking.

Su objetivo es explicar cómo se organiza el sistema activo, qué responsabilidades tiene cada capa y qué límites deben respetarse al evolucionar la aplicación.

No define el producto, el modelo de dominio, reglas concretas, diseño visual, testing, backlog ni procedimientos operativos detallados. Esos temas pertenecen a documentos especializados.

## Runtime activo

La aplicación activa vive en:

- `cloud/web`
- `cloud/supabase`

`cloud/web` contiene la aplicación web construida con Next.js, React y TypeScript.

`cloud/supabase` contiene schema, migrations, funciones SQL y verificadores relacionados con Supabase/Postgres.

La persistencia activa es Supabase/Postgres.

La app web se desarrolla como una aplicación cloud con autenticación, datos por usuario, integraciones externas de lectura/importación/sincronización y superficies administrativas restringidas.

## Vista general

La arquitectura actual puede entenderse así:

```text
Usuario
  ↓
Rutas Next.js
  ↓
Componentes React
  ↓
Lógica de aplicación
  ├──── Supabase/Postgres
  │
  └──── Proveedores externos
```

Las rutas definen puntos de entrada.

Los componentes construyen la experiencia visible.

La lógica de aplicación concentra reglas reutilizables, acciones, lectura de datos, sincronización, métricas, accesos y adaptadores.

Supabase/Postgres guarda la fuente de verdad interna.

Los proveedores externos entregan datos que la app lee, adapta, compara y eventualmente aplica sobre objetos locales.

Existe una frontera server-side mínima en Next.js para finalizar la autorización Google de datos. Esa ruta no reemplaza a Supabase como backend principal de la app; encapsula una operación privilegiada específica: validar evidencia OAuth, derivar permisos efectivos y persistir la cuenta conectada canónica con service role.

## Capa de rutas y UI

Las rutas viven bajo `cloud/web/app`.

El patrón observado es que las rutas son mayormente entradas delgadas. Montan autenticación, navegación y una experiencia principal, delegando el comportamiento a componentes.

La autenticación visible se monta mediante `AuthGate`. Esa frontera ofrece Google login como entrada principal de identidad y magic link por email como alternativa. Luego resuelve sesión Supabase y consulta el acceso efectivo de la app antes de renderizar el shell privado.

La navegación general se centraliza en `Shell`.

Los componentes viven en `cloud/web/components`.

Esta capa debe encargarse de:

- presentar información;
- capturar intención del usuario;
- administrar estado visual local;
- abrir diálogos o previews;
- invocar funciones reutilizables de aplicación.

La UI no debe ser la fuente principal de reglas de negocio, resolución de conflictos, permisos, sincronización o persistencia.

Cuando una pieza visual o interacción se reutiliza en varias vistas, debe preferirse un componente compartido con variantes explícitas.

Las primitivas visuales compartidas viven en `cloud/web/components/ui`.

## Lógica de aplicación

La lógica reutilizable vive principalmente en `cloud/web/lib`.

Se observan módulos para:

- lectura y armado de datos para pantalla;
- acciones sobre objetos de la app;
- sincronización e importación;
- integración con proveedor externo;
- filtros;
- métricas y cálculos derivados;
- Coach;
- logs;
- accesos;
- configuración y mantención.

Esta capa es la frontera preferida para lógica que pueda ser usada desde más de una vista.

Si una operación puede ser ejecutada desde UI, Coach u otros consumidores, no debería quedar codificada solamente dentro de un componente visual.

Las funciones compartidas deben tener responsabilidad clara, nombres descriptivos y contratos de entrada/salida razonables.

La lógica derivada compartida no debe duplicarse entre vistas. Si una métrica, agrupación, filtro o clasificación aparece en más de un lugar, debe vivir en una función común.

## Persistencia y acceso a datos

Supabase/Postgres es la persistencia activa.

La estructura de base de datos evoluciona mediante archivos en `cloud/supabase`.

El cliente Supabase central observado está en `cloud/web/lib/supabaseClient.ts`.

Los objetos locales de la app deben conservar IDs propios. Las identidades externas de proveedores se almacenan como referencias, no como identidad primaria del producto.

Esta separación permite que un contacto, interacción u otro objeto local exista aunque cambie, falle o se desconecte un proveedor externo.

El acceso a datos debe respetar autenticación, aislamiento por usuario y permisos efectivos.

Las restricciones relevantes deben reforzarse en base de datos, RPCs, RLS o fronteras equivalentes cuando corresponda. Ocultar botones en UI no es suficiente para proteger operaciones sensibles.

## Integraciones externas

El proveedor implementado actualmente es Google.

Estado actual: existen módulos específicos de Google para leer y sincronizar datos, junto con conceptos internos más generales como proveedor, cuenta conectada, identidad externa y fuente externa.

Google login y Google Connected Account son intents separados. El primero autentica identidad con scopes mínimos; el segundo habilita lectura/importación/sincronización de datos solo después de un consentimiento explícito de conexión.

La finalización de Google Connected Account ocurre en una ruta server-side. El navegador puede entregar el `provider_token` temporal recibido en la sesión, pero no declara `user_id`, email externo, scopes efectivos, capabilities ni estado de conexión. La ruta valida sesión Supabase, acceso efectivo, identidad Google, audience del token, expiración y scopes efectivos antes de persistir.

Boundary adoptado: la lógica de dominio y los objetos locales no deben depender del formato crudo específico del proveedor.

Los módulos de integración deben transformar datos externos hacia estructuras internas antes de que esos datos afecten objetos locales o previews de usuario.

No debe asumirse que todos los proveedores futuros tendrán los mismos campos, permisos, cursores, límites o semántica de cambios.

Deuda vigente: antes de ampliar proveedores, debe formalizarse mejor el contrato común de integración/adapters.

## Importación y sincronización

Los flujos actuales siguen un patrón general observado:

```text
Proveedor
  ↓
Lectura
  ↓
Adaptación / comparación
  ↓
Preview
  ↓
Aplicación
  ↓
Persistencia / logs / cursores
```

Este patrón no implica que exista un único orquestador universal para todos los recursos. Distintos recursos pueden tener implementaciones separadas.

La lectura obtiene datos desde un proveedor o fuente.

La adaptación convierte esos datos a una forma interna usable por la app.

La comparación determina si existen elementos nuevos, modificados, omitidos o equivalentes según el recurso.

El preview permite mostrar propuestas antes de guardar cuando el cambio afecta datos del usuario.

La aplicación persiste cambios confirmados y registra resultado.

Los logs y cursores permiten diagnosticar ejecuciones y continuar procesos incrementales cuando el proveedor lo permite.

El flujo de sync/import no debe depender conceptualmente de una pantalla específica. Una misma capacidad debería poder invocarse desde distintas entradas si el caso de uso lo requiere.

## Acciones internas y Coach

Existen módulos de acciones reutilizables en `cloud/web/lib`, por ejemplo familias `*Actions.ts`.

Varias operaciones ya se centralizan fuera de la UI, lo que permite reutilizarlas desde componentes, diálogos o subsistemas.

Coach se organiza como un subsystem con motor de reglas, disparadores, sugerencias, acciones, configuración y logs.

Coach debe apoyarse en datos internos y acciones estructuradas.

Coach no debe manipular pantallas para provocar cambios. Debe proponer o ejecutar operaciones mediante funciones compartidas que validen permisos, inputs e impacto.

La estandarización completa de un contrato común de acciones sigue siendo deuda arquitectónica.

Los contratos concretos de acciones no pertenecen a este documento.

## Seguridad y aislamiento

La autenticación observada usa Supabase Auth. El login Google visible en `AuthGate` usa provider `google` para identidad y no debe solicitar permisos de Contacts, Gmail o Calendar.

El frontend no reconstruye la lógica de allowlist, roles, plan ni perfil de acceso. `AuthGate` consume la RPC `current_user_app_access_status()` después de confirmar sesión y solo renderiza `Shell` cuando la respuesta permite acceso. Si la RPC deniega o falla, la app opera fail-closed y no muestra vistas privadas.

La app web usa un cliente Supabase público/browser para el runtime normal. La excepción vigente es la ruta server-side mínima de finalización Google, que usa service role solo del lado servidor para escribir una cuenta conectada ya verificada.

El control de permisos observado incluye validación de capacidades mediante funciones como `current_user_has_capability`.

Las superficies administrativas deben estar restringidas por permisos reales.

Las operaciones sensibles deben validar acceso antes de ejecutarse y, cuando corresponda, apoyarse en enforcement de base de datos mediante RLS, RPCs u otro mecanismo equivalente.

Las cuentas conectadas y tokens de proveedor deben tratarse como datos sensibles. El `provider_token` de Google usado para autorizar datos es temporal: no debe persistirse, loguearse ni devolverse en responses.

Las operaciones con impacto externo o datos reales deben ser explícitas, auditables y coherentes con los permisos del usuario.

Deuda vigente: existe una frontera server-side estrecha para finalizar Google data OAuth, pero no una capa backend privilegiada general para todas las operaciones sensibles. Esta frontera debe revisarse antes de ampliar administración multiusuario, background sync o integraciones con mayor alcance.

## Boundaries arquitectónicos

Las rutas deben mantenerse delgadas.

Los componentes no deben concentrar lógica reutilizable de negocio, sync, permisos o métricas.

La lógica específica de proveedor no debe definir el dominio de la app.

Los objetos locales deben conservar identidad propia independiente de identidades externas.

Las identidades externas deben vincular objetos locales con objetos de proveedor sin sustituirlos.

Las operaciones sensibles requieren autorización efectiva, no solo controles visuales.

Sync e importación deben poder reutilizar lógica fuera de una pantalla concreta.

Coach debe delegar cambios de datos a acciones o funciones compartidas.

La lógica derivada compartida debe centralizarse para evitar resultados distintos entre vistas.

Los maestros globales deben diferenciarse de datos propios de usuario.

Los logs deben ayudar a diagnosticar flujos relevantes sin convertirse en fuente primaria del dominio.

## Deuda arquitectónica vigente

El contrato común para integraciones externas todavía debe formalizarse antes de sumar nuevos proveedores.

El patrón de acciones internas existe, pero falta definirlo como contrato uniforme para UI, Coach y otros consumidores.

La frontera cliente/servidor debe revisarse para operaciones privilegiadas, manejo de tokens, administración y escalamiento multiusuario.

Algunas decisiones de orquestación pueden seguir cerca de componentes de entrada. La dirección recomendada es mover esas decisiones a funciones o flujos compartidos cuando se reutilicen.

Este documento debe mantenerse como mapa arquitectónico de alto nivel y no absorber producto, dominio, testing, UI, reglas concretas ni modelo de datos detallado.
