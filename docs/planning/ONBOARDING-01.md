# ONBOARDING-01

Estado: candidato local, pendiente de revisión del owner. Sin commit, push, SQL ni operaciones remotas.

## Contrato

- La introducción conserva sus cuatro slides, copy y comportamiento.
- Tres pasos: Tu objetivo, Carga tu red, Tu tablero. Header exclusivo con marca, tracker persistente y Saltar el tour. Coach real con explicación únicamente. Navegación inferior independiente.
- Perfil y ciclo usan StartingPointFields y NetworkingCyclePanel. La fecha real de inicio sigue configurándose explícitamente en el diálogo canónico, sin inventarla ni duplicarla. La variante onboarding oculta las acciones de gestión (cierre y Avísame) y conserva la creación/configuración necesaria. En INT-01, nombre y situación profesional comparten presentación con Cuenta: "¿Cómo te llamas?" y "Situación profesional", sin alterar persistencia.
- Chips de industrias/cargos/empresas escriben mediante saveObjective. Nuevas prioridades MEDIUM (nivel 2); existentes conservan ID/nivel/relaciones; deselección desactiva, no elimina. No hay máximo de selecciones: "Elige al menos una prioridad" conserva el ícono oficial tag y requiere al menos una guardada para avanzar. Personalizadas usan el mismo escritor.
- ContactTable recibe una variante tutorial acotada: tabla sin filtros, Importar y Crear contacto reales, y kanban compacto sin agrupación HH. No hay datos demo en el runtime. El fixture separado usa exclusivamente datos sintéticos locales.
- Paso 2 requiere un contacto y oculta encabezados solo mientras la tabla del tutorial esté vacía. Paso 3 requiere confirmación de una transición real Pendiente a Contactado; se conserva el drag & drop y las tarjetas reales, sin dropdown ni navegación a la ficha. "Guardado ✓" aparece solo tras completar el guardado; los errores se conservan.
- Saltar finaliza desde cualquier paso guiado y lleva a `/`, preservando escrituras anteriores. Empezar requiere ejercicio confirmado. No se borran contactos, prioridades ni ciclos.

## Persistencia y compatibilidad

Se mantiene user_settings/product_onboarding_v1, versión 1. `boardExerciseCompleted` es opcional y se serializa solo al confirmar el guardado; no agrega schema ni permisos. Los parsers anteriores ignoran el campo adicional. Los IDs legacy siguen siendo aceptados: starting_point pasa a objectives; contact/final a contacts. Un completed existente no se reabre. El replay no sobrescribe completed; las ediciones de datos siguen siendo reales y explícitas.

Si guardar el contacto funciona pero falla guardar el avance, se ofrece reintentar el avance sin repetir la transición. Si falla el contacto, no hay felicitación. Usuarios que no tienen ningún contacto Pendiente pueden saltar; no se cambian estados automáticamente.

## Copy aprobado

1. "Cuéntame quién eres y qué buscas: tu nombre, en qué punto está tu carrera hoy, y crea tu primer objetivo con los cafés: el cargo, la industria o el tipo de empresa que priorizarás. Con uno basta para partir, después sumas más."
2. "Partamos con lo más fácil: agrega a la persona que te invitó a Coffeecito. Después suma 2 o 3 contactos más que quieras tener presentes en tu búsqueda."
3. "Este es tu tablero: acá vive tu red. Arrastra tu contacto a 'Contactado' y mira cómo funciona."
4. '¡Eso! Así se mueve tu red. Tu networking ya partió 🎉 Aprieta "Empezar" y sigamos con los próximos pasos.'

El owner autorizó corregir "y tu crea" a "y crea". Los nombres de estados son los reales del producto, no abreviaciones de la maqueta.

El ajuste visual comparte ShellHeader con ShellChrome, el asset oficial sin filtros y las clases application-shell-v2/shell-top-region de shell.css, sin duplicar colores o fondo. Las prioridades reutilizan objective-chip como pills con aria-pressed, sin checkboxes visibles. El Coach conserva fuente, avatar y burbuja oficiales; su contenido guiado usa 16 px e interlineado 1.6.

Las tarjetas de objetivos comparten la compactación en onboarding y Objetivos normal: mínimo desktop de 148 px (antes 176 en tutorial y 210 en Objetivos), padding de 16 px y acciones centradas. El objetivo activo usa verde pálido y glow suave con tokens existentes; las reglas de tracking no anulan ese estado. Finalizar proceso y Avísame se conservan en Objetivos. Los títulos comparten panel-header/panel-title, icono oficial de 20 px y gap de 8 px; Prioridades reutiliza Icon tag. Los labels globales pasan a Dependiente y En búsqueda activa en StartingPointFields (onboarding y Cuenta), conservando los códigos persistidos employed/unemployed, sin migration.

## Validación y límites

Tests focales de compatibilidad, prioridades, shell, Coach y tablero; typecheck y build local. `cloud/web/tests/local/onboarding-three-step-preview.cjs` monta componentes reales con adaptadores sintéticos, loopback, CSP connect-src none y almacenamiento separado del producto. Permite revisión en navegador integrado sin Auth, Supabase ni credenciales. No certifica escrituras remotas ni OAuth/importaciones reales.

El contacto residual de prueba procedía del localStorage compartido por el preview normal y `?fail-save`, no de una precarga del producto. El preview ahora usa namespaces versionados separados para ambos escenarios y no lee ni elimina las claves anteriores. Se conserva la prueba negativa. La persistencia sintética continúa dentro de cada escenario.

No se modifican SQL, RLS, acciones de importación ni contratos de ciclo. INT-01 incorpora este candidato junto a LANDING-01 y GAM-01 en un worktree independiente, preservando los originales. El smoke autenticado de persistencia/importación queda para autorización separada.

La revisión ampliada detectó cinco fallos ya presentes en el baseline: cuatro en productRoutes.test.ts y uno en systemAccess.test.ts, basados en la estructura de rutas anterior a UI-STRUCT. No se corrigen en esta iniciativa. Las comprobaciones directamente afectadas por retirar el header legacy se actualizan para comprobar ShellChrome y el logo actual.

Validación anterior del candidato: 131 tests focales/regresiones relacionadas PASS; systemAccess 10 PASS y un fallo preexistente; productRoutes conserva sus cuatro fallos preexistentes. El refinamiento UX pasó 69 tests afectados, typecheck y build webpack local con fuente cacheada. Navegador integrado: tres pasos revisados en desktop y 320 px, comprobación adicional a 390 px, sin overflow horizontal de página. Se verificaron seis prioridades (incluida una personalizada), bloqueo con cero, reactivación, tabla vacía/con datos, arrastre confirmado, mensaje final y fallo sin felicitación. Los escenarios normal/error conservaron datos separados. El área de tarjetas mantiene 292 px y scroll interno. No se certifica importación remota ni todas las variantes de Cuenta/Objetivos por navegador.

## Archivos del candidato

La pasada adicional de consistencia visual y labels pasó 65 tests focales, typecheck y build webpack local con fuente cacheada. Se compararon onboarding y Objetivos reales mediante adaptadores sintéticos a 1280/320 px (390 px adicional en onboarding), sin overflow horizontal. Se comprobó apertura/cancelación de Finalizar proceso, respuesta local de Avísame y labels/códigos de Cuenta. No se ejecutó cierre de ciclo remoto; su lógica conserva los tests focales vigentes.

- `cloud/web/app/globals.css`
- `cloud/web/components/CoachPreview.tsx`
- `cloud/web/components/ContactImportDialog.tsx`
- `cloud/web/components/ContactTable.tsx`
- `cloud/web/components/OnboardingPriorities.tsx`
- `cloud/web/components/NetworkingCyclePanel.tsx`
- `cloud/web/components/OnboardingProvider.tsx`
- `cloud/web/components/OnboardingRoutePage.tsx`
- `cloud/web/components/Shell.tsx`
- `cloud/web/components/ShellChrome.tsx`
- `cloud/web/components/ShellHeader.tsx`
- `cloud/web/components/StartingPointFields.tsx`
- `cloud/web/lib/contactActions.ts`
- `cloud/web/lib/onboarding.ts`
- `cloud/web/lib/onboardingPriorities.ts`
- `cloud/web/lib/startingPoint.ts`
- `cloud/web/styles/onboarding.css`
- `cloud/web/styles/components.css`
- `cloud/web/styles/tracking.css`
- `cloud/web/tests/brandBeta.test.ts`
- `cloud/web/tests/onboarding.test.ts`
- `cloud/web/tests/onboardingPriorities.test.ts`
- `cloud/web/tests/onboardingVisual.test.ts`
- `cloud/web/tests/objectivePresentation.test.ts`
- `cloud/web/tests/onboardingPreview.test.cjs`
- `cloud/web/tests/local/onboarding-preview-storage.cjs`
- `cloud/web/tests/systemAccess.test.ts`
- `cloud/web/tests/local/onboarding-three-step-preview.cjs`
- `docs/ACTIVE_PLAN.md`
- `docs/UI_SYSTEM.md`
- `docs/planning/ONBOARDING-01.md`
