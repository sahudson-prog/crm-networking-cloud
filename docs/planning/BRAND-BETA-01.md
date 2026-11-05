# BRAND-BETA-01 - Variante de marca beta

## Estado y autoridad

- Status: implementada localmente y aprobada visualmente por el owner como candidata de la release conjunta Beta UX V1, junto con UX-ONB-COPY-01 y UX-DATE-01. No está desplegada.
- La decisión final es únicamente un distintivo `BETA` junto al wordmark. No se añaden mensajes, avisos ni copy sobre acceso anticipado, restricciones o planes futuros.

## Contrato visual aprobado

- Preservar el isotipo oficial y el wordmark `Coffeecito` sin editar el asset base.
- Situar un distintivo pequeño debajo del extremo derecho del wordmark, bajo "cito", levemente montado sobre su base visual y sin alargar el lockup.
- Mantenerlo discreto, profesional, accesible y responsive. En la cabecera es más compacto que en landing y onboarding.
- El distintivo BETA no se aplica al favicon ni al app icon. La corrección proporcional del favicon derivado está aprobada por separado; no cambia el isotipo maestro, la navegación ni los textos del tutorial.

## Superficies verificadas

El inventario de usos del isotipo en componentes de `cloud/web` contiene cinco lockups:

| Superficie | Componente | Variante |
| --- | --- | --- |
| Landing de acceso | `AuthGate` | BETA / original |
| Introducción del onboarding | `OnboardingRoutePage` | BETA / original |
| Aceptación legal del onboarding | `LegalAcceptanceGate` | BETA / original |
| Cabecera autenticada | `Shell` | BETA / original |
| Contacto público | `PublicContactPage` | BETA / original |

El favicon/app icon derivado usa únicamente la taza original, sin BETA; los logos de proveedores no son lockups de Coffeecito.

## Favicon derivado

- `cloud/web/public/brand/coffeecito-isotipo.svg` es el isotipo maestro, intacto. `cloud/web/app/icon.svg` conserva sus mismas formas, trazos y colores.
- El derivado usa lienzo cuadrado `64×64`, `viewBox="34 -72 1554 1554"` y `preserveAspectRatio="xMidYMid meet"`: centra el contorno visible, lo escala uniformemente y deja el mínimo margen de seguridad sin recortar taza ni asa.
- Si el isotipo maestro cambia en el futuro, se debe actualizar el derivado a partir de ese maestro y recalcular el encuadre cuadrado; validar de nuevo a 16, 32 y 48 px. El favicon no hereda el toggle BETA.

## Activación y retirada

- `BRAND_BETA_ENABLED` es el único toggle, inicialmente `true`, en `cloud/web/components/ui/BrandBetaWordmark.tsx`. Es una constante local; no depende de Supabase ni de configuración remota.
- Las cinco superficies reutilizan `BrandBetaWordmark` y `BRAND_ACCESSIBLE_NAME`. Con `false`, el componente devuelve el `<span>` original sin badge, clases ni espacio residual, y el nombre accesible vuelve a `Coffeecito`.
- Para desactivar temporalmente, cambiar solo `BRAND_BETA_ENABLED` a `false`, ejecutar pruebas de ambas variantes, typecheck, build y revisión visual desktop/móvil antes de publicar.
- Pendiente explícito al finalizar la beta: retirar el distintivo. Primero desactivarlo y validar; después eliminar el toggle, el componente y sus estilos BETA en un cambio separado, conservando el isotipo y los lockups originales.

## Gates

- Pruebas focales, typecheck y build PASS; landing y favicon aprobados por el owner. Revisión autenticada DEV PASS para cabecera y replay del onboarding; aceptación legal PASS con fixture aislado del componente real, sin aceptar términos ni alterar datos. La publicación y el smoke de la release conjunta Beta UX V1 siguen pendientes.
- Fuera de alcance: Contactos presenta aproximadamente 55 px de overflow horizontal a 320 px, originado fuera del lockup BETA. Queda pendiente de QA-UX-01; no se corrige en BRAND-BETA-01.
- No hay cambios persistentes, permisos ni servicios externos en este contrato.
