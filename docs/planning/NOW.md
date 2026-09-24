# Now

## Iniciativa activa

Lanzar la beta cerrada de Coffeecito y aprender de su uso real, manteniendo una frontera clara entre experiencia de usuario y herramientas operacionales.

## Estado de partida

PROD está operativo con acceso por allowlist, Google login PKCE, magic link protegido por Turnstile, administración inicial y Google Connected Account.

Contacts, Gmail y Calendar funcionan con preview y aplicación de cambios. Google OAuth PROD permanece en Testing.

La navegación y las rutas de Sistema usan capabilities administrativas efectivas y fallan cerradas antes de montar superficies privadas.

## Siguiente implementación

Endurecer la lectura de `sync_run_logs`: el usuario final no debe poder leer logs, `admin.view_diagnostics` sí, y los flujos normales deben conservar el INSERT propio. Es un `PROD CONTRACT CHANGE` que requiere migration y verifier.

## Siguiente desarrollo de producto

Después de ese hardening, diseñar e implementar un onboarding inicial que explique Coffeecito, guíe la configuración básica y ayude a completar un primer flujo útil.

Landing, branding y una primera cohorte de beta testers son parte del foco inmediato.

## Trabajo paralelo

Auditar privacidad, seguridad y cumplimiento aplicable antes de publicar políticas definitivas.

Diseñar la separación futura del consentimiento Google: Contacts + Calendar como autorización inicial de datos y Gmail como autorización adicional opcional.

## Fuera de alcance inmediato

Verificación final de Google, eventual security assessment, Microsoft, WhatsApp, automatizaciones avanzadas, monetización y planes comerciales definitivos.
