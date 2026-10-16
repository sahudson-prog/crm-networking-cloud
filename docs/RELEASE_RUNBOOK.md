# Runbook de releases

## Propósito

Este documento es el owner operativo del flujo feature -> DEV -> Pull Request -> PROD -> sincronización local de Coffeecito. `docs/ACTIVE_PLAN.md` define qué se ejecuta; `docs/PROD_CONTRACTS.md` gobierna compatibilidad persistente; `docs/ENVIRONMENTS.md` define los ambientes.

## Repositorio canónico

- Coffeecito mantiene un único clone local canónico activo. GitHub es la fuente durable de verdad.
- El checkout canónico de `main` permanece limpio, reservado a `main` y no recibe implementación de features.
- Cada feature usa un `git worktree` temporal y recreable, creado desde `origin/main` recién actualizado. No se crean clones independientes adicionales para features.
- Repositorios históricos o de recovery no se usan para planificar ni implementar.
- Si aparecen varios repositorios independientes aparentemente activos, `STOP`: identificar el canónico antes de continuar.

## Preflight de una tarea

Desde canonical `main`, antes de validar un baseline basado en `main`:

```text
git fetch origin main --prune
git remote -v
git rev-parse origin/main
git status --short --branch
```

Verificar el remote, el SHA real de `origin/main`, la limpieza de canonical `main`, el baseline esperado cuando exista y la branch/worktree de la tarea. `origin/main` es una referencia local y no consulta GitHub en tiempo real.

El fetch es read-only respecto del remoto. No autoriza `pull`, merge, rebase, push ni otros efectos externos.

## Feature worktree

- Crear branch y worktree desde `origin/main` recién fetched, sin tracking accidental de `origin/main`.
- La branch obtiene upstream de su propia remote branch únicamente al publicarla.
- Canonical `main` no recibe cambios de la feature directamente.
- Antes de implementar, leer `AGENTS.md`, `docs/ACTIVE_PLAN.md` y solo los owner docs directamente relevantes.
- Código, schema, tests y configuración prevalecen ante documentación desactualizada.

## Desarrollo local y DEV

- Confirmar explícitamente que todo runtime local usa DEV; no inferir el ambiente por ruta, branch o nombre.
- `.env.local` no se versiona. PROD secrets no se copian a DEV ni Preview.
- Validar localmente de forma proporcional al cambio.
- SQL remoto DEV y toda escritura en servicios externos requieren autorización explícita.

## Cambios persistentes

Si un cambio afecta schema, migrations, RLS, Auth, OAuth o contratos persistentes, seguir `docs/PROD_CONTRACTS.md` y los owner docs correspondientes.

- Una migration aplicada no se reescribe; toda evolución posterior es incremental.
- DEV y PROD son ambientes separados. Nunca reemplazar PROD por DEV.
- Definir compatibilidad, backup, rollback y mantenimiento según el riesgo del contrato.

## Commit y publicación de branch

Commit y push requieren autorización explícita.

Al publicar una feature:

- stagear únicamente el alcance aprobado;
- hacer push a la propia branch;
- configurar upstream de esa misma branch, nunca de `origin/main`;
- `STOP` después del push y reportar SHA, archivos y validaciones.

Codex no crea Pull Requests.

## Pull Request y merge

- El usuario crea el Pull Request manualmente desde GitHub Web.
- Codex entrega repository, base y head verificados, título, descripción y archivos, commits y checks a revisar.
- Crear el PR y hacer merge son gates distintos.
- El usuario realiza personalmente el merge desde GitHub Web.
- Después del merge, verificar el SHA realmente integrado en `main`.
- Un merge Git no demuestra un deployment exitoso.

## Deployment PROD

Para Vercel Production:

- verificar el deployment real;
- confirmar el commit/SHA asociado;
- exigir estado exitoso;
- ejecutar el smoke PROD correspondiente.

Para cambios de base de datos, seguir el orden aprobado para la release. Cuando aplique:

```text
migration -> verifier focal -> verifier canónico -> deployment -> smoke
```

No ejecutar SQL PROD sin autorización explícita.

## Sincronización local post-release

Después de merge, deployment y smoke requerido —o `N/A` explícitamente justificado—, desde canonical `main` limpio:

```text
git fetch origin main --prune
git merge --ff-only origin/main
git status --short --branch
```

Verificar:

- `HEAD = main = origin/main`;
- working tree limpio;
- migrations, docs y assets mergeados presentes físicamente en canonical `main`.

Si canonical `main` está sucio o el avance no es fast-forward, `STOP`. No usar reset ni rebase para corregirlo.

## Ciclo de vida de worktrees

Un feature worktree es temporal. Puede retirarse únicamente después de:

- confirmar el merge;
- sincronizar canonical `main`;
- revisar cambios y archivos locales o ignorados relevantes;
- obtener autorización explícita para la limpieza.

No es obligatorio retirar worktrees en cada release.

## Paths operacionales

- La documentación versionada usa paths relativos al repositorio, nunca paths personales de Windows, macOS o Linux.
- Después del merge, SQL e instrucciones manuales se referencian desde canonical repo, no desde worktrees temporales.
- Antes del merge puede usarse un worktree para validar la feature que contiene.

## Recuperación de un PC

GitHub reconstruye código, documentación, migrations, verifiers, tests e historial. Los worktrees se recrean.

Secrets y `.env.local` no se reconstruyen desde Git: deben recuperarse desde fuentes seguras, dashboards o password manager. Supabase, Vercel, Google y Cloudflare son servicios externos al PC. Backup y restauración de datos PROD son un problema separado del clone local.

## Condiciones de STOP

Detenerse ante:

- baseline remoto inesperado;
- canonical `main` sucio cuando debe usarse o sincronizarse;
- múltiples repositorios aparentemente activos sin canonical claro;
- conflicto o avance no fast-forward;
- migration aplicada modificada;
- ambiente DEV/PROD ambiguo;
- secreto detectado;
- deployment no confirmado;
- smoke fallido;
- contradicción material entre el repositorio, `docs/ACTIVE_PLAN.md` y los owner docs.
