# Now

## Iniciativa activa

Lanzar la beta cerrada de Coffeecito y aprender de su uso real, manteniendo una frontera clara entre experiencia de usuario y herramientas operacionales.

## Estado de partida

PROD está operativo con acceso por allowlist, Google login PKCE, magic link protegido por Turnstile, administración inicial y Google Connected Account.

Contacts, Gmail y Calendar funcionan con preview y aplicación de cambios. Google OAuth PROD permanece en Testing.

La navegación y las rutas de Sistema usan capabilities administrativas efectivas y fallan cerradas antes de montar superficies privadas.

## Estado de seguridad reciente

El hardening de `sync_run_logs` está implementado y mergeado a `main`. La migration ya se aplicó en DEV y la lectura administrativa con `admin.view_diagnostics` fue validada allí. Queda pendiente el smoke de usuario base por un rate limit temporal de Supabase Auth. El verifier específico no puede completar en DEV mientras persista el drift preexistente de grants amplios, tratado como hallazgo separado.

PROD no ha recibido esta migration. Su promoción queda pendiente para un release posterior, probablemente junto con onboarding. El drift preexistente de grants amplios en DEV se mantiene como hallazgo separado.

## Siguiente desarrollo de producto

Diseñar e implementar un onboarding inicial que explique Coffeecito, guíe la configuración básica y ayude a completar un primer flujo útil.

Landing, branding y una primera cohorte de beta testers son parte del foco inmediato.

## Trabajo paralelo

Auditar privacidad, seguridad y cumplimiento aplicable antes de publicar políticas definitivas.

Diseñar la separación futura del consentimiento Google: Contacts + Calendar como autorización inicial de datos y Gmail como autorización adicional opcional.

## Fuera de alcance inmediato

Verificación final de Google, eventual security assessment, Microsoft, WhatsApp, automatizaciones avanzadas, monetización y planes comerciales definitivos.
