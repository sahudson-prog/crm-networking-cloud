# Now

## Iniciativa activa

Preparar la beta cerrada de Coffeecito con onboarding controlado, login Google y acceso administrativo por allowlist.

## Fase actual

Google login con scopes mínimos.

Fases 1 a 3 de beta cerrada quedaron completadas: foundation/enforcement SQL de allowlist, AuthGate con decisión efectiva de Supabase y administración de allowlist/diagnóstico desde Mantención.

Invariante actual: Google login no conecta datos Google. El login autentica identidad; Google Connected Account queda para consentimiento explícito posterior.

## Resultado esperado

El usuario invitado puede iniciar sesión con Google usando scopes mínimos de identidad, y la app mantiene el acceso cerrado por decisión efectiva de Supabase antes de mostrar vistas privadas.

## Fuera de alcance inmediato

Google Connected Account explícita, landing/branding final, dominio productivo, cambios funcionales ajenos al onboarding y pruebas con una segunda cuenta no allowlisted.

## Siguiente fase prevista

Google Connected Account explícita. La prueba de signup no autorizado queda pendiente para el smoke beta.
