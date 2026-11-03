# BRAND-BETA-01 - Variante de marca beta

## Estado y autoridad

- Status: `NEXT / SELECTED FOR IMPLEMENTATION`. Esta especificación no autoriza cambios de producto por sí sola.
- Este documento conserva las decisiones de producto para una variante temporal de marca durante la beta.
- No autoriza cambios de assets, UI, landing, onboarding ni cabecera.

## Decisiones funcionales aprobadas

- Los recursos originales de marca se preservan versionados en Git.
- Se añadirá una variante temporal `BETA` sin sobrescribir el isotipo ni las composiciones originales.
- La variante se aplicará en landing, onboarding y cabecera.
- Debe comunicar acceso anticipado y la posibilidad de futuras restricciones o planes pagados.
- La presencia BETA será discreta y profesional junto a Coffeecito; comunicará que el producto está en pruebas y puede cambiar.
- Debe ser reversible, responsive y accesible, sin banners invasivos ni cambios generales de identidad.

## Pendientes de auditoría y diseño técnico

Antes de contratar implementación deben definirse:

- composición visual exacta de la variante y sus assets derivados;
- superficies, breakpoints y reglas de accesibilidad donde se mostrará;
- copy final de acceso anticipado, restricciones y planes futuros;
- mecanismo de activación temporal y su retirada posterior;
- pruebas visuales y de navegación;
- compatibilidad con el contrato visual y assets actuales sin reemplazar sus fuentes originales.

## Alcance y gates

- Hipótesis a validar: una señal BETA breve en las tres superficies comunica el estado del producto sin interrumpir los recorridos existentes.
- Excluye rediseñar la marca completa, reemplazar assets originales, cambiar permisos o ampliar el acceso beta.
- Antes de implementar: aprobar composición y copy final; inventariar assets/superficies vigentes y definir activación/retirada reversible.
- Antes de publicar: revisión visual desktop/móvil, contraste, teclado y lectores de pantalla; deployment y smoke por los gates habituales. No hay cambios persistentes previstos por este contrato.

## Owner docs probables al contratar

- `docs/PRODUCT.md`
- `docs/UI_SYSTEM.md`
- `docs/ENVIRONMENTS.md` solo si la activación requiere configuración de ambiente
