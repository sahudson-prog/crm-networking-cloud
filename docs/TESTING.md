# Testing y validación

## Propósito

Este documento describe las herramientas y rutas de validación disponibles hoy para la aplicación cloud de CRM Networking. Su foco es la práctica real de pruebas observada en el repositorio: comandos disponibles, cobertura automatizada existente, verificaciones manuales necesarias y deuda conocida.

AGENTS.md contiene la regla transversal de validar proporcionalmente al riesgo y alcance. Este documento identifica qué herramientas concretas existen para hacerlo.

## Alcance actual

La infraestructura de pruebas vigente vive en `cloud/web`.

El stack validado es:

- Next.js, React y TypeScript.
- Supabase como backend y base de datos.
- Tests automatizados con el runner nativo de Node.js (`node --test`).
- Archivos TypeScript ejecutados con flags de Node para strip de tipos.

No se observó un comando global `npm test`, lint configurado, pipeline CI, suite de navegador, pruebas visuales automatizadas, cobertura formal ni harness automatizado de SQL/RLS.

## Comandos confirmados

Ejecutar desde `cloud/web`.

```powershell
npm run typecheck
```

Valida TypeScript con `tsc --noEmit`.

```powershell
npm run build
```

Valida que Next.js pueda compilar la aplicación.

```powershell
npm run test:kpis
```

Ejecuta pruebas de cálculos KPI.

```powershell
npm run test:rules
```

Ejecuta pruebas del motor de reglas Coach.

```powershell
npm run test:headhunter-master
```

Ejecuta pruebas del maestro de empresas headhunter.

```powershell
npm run test:logs
```

Ejecuta pruebas de logs y diagnósticos de lectura de interacciones externas.

```powershell
npm run test:google-adapter
```

Ejecuta pruebas de adapters/clientes/flujos Google para contactos e interacciones.

```powershell
npm run test:sync
```

Ejecuta la suite más amplia de sincronización, incluyendo preview, aplicación, cursores, normalización de teléfonos, merge y revisión de duplicados.

## Cobertura automatizada observada

Los tests actuales cubren principalmente lógica pura o flujos aislados en TypeScript.

Áreas con cobertura observada:

- Cálculo de KPIs y periodos.
- Métricas de objetivos.
- Motor de reglas Coach.
- Maestro de empresas headhunter.
- Normalización e identidad de teléfonos.
- Preview y aplicación de sincronización de contactos.
- Merge de contactos y revisión de duplicados locales.
- Orquestación de sincronización y cursores.
- Google Contacts: adapter, cliente y flujo de preview.
- Gmail y Calendar: adapters, clientes y flujo de sincronización.
- Logs de sincronización y sanitización de datos sensibles.
- Diagnósticos de lectura de interacciones externas.

El archivo `tests/objectiveMetrics.test.ts` existe, pero no se observó incluido en un script npm dedicado. Hasta que se cablee explícitamente, debe tratarse como cobertura existente pero no integrada al flujo estándar.

## Qué validar según el tipo de cambio

Para cambios pequeños en lógica cubierta por tests, ejecutar primero el script específico correspondiente.

Para cambios de tipos, contratos compartidos, imports o estructura de componentes, ejecutar `npm run typecheck`.

Para cambios en rutas Next.js, server/client components, configuración de build, dependencias o estructura transversal, ejecutar `npm run build`.

Para cambios de sincronización de contactos, ejecutar al menos `npm run test:sync`. Si el cambio toca adapters o clientes Google, agregar `npm run test:google-adapter`.

Para cambios en Coach, ejecutar `npm run test:rules`.

Para cambios en KPIs, existe `npm run test:kpis`. Para métricas de objetivos existe `tests/objectiveMetrics.test.ts`, pero no se observó un script npm dedicado que lo integre al flujo estándar.

Para cambios de UI, además de typecheck o build cuando corresponda, realizar revisión manual en navegador. La revisión debe verificar que la vista renderiza, que las acciones principales siguen disponibles y que los estados de carga, vacío y error no rompen el layout.

Para cambios de SQL, RLS, permisos o funciones Supabase, revisar la migration o script afectado y usar los verificadores SQL existentes cuando apliquen. No hay evidencia de una suite SQL automatizada integrada al flujo npm.

## Comprobación manual necesaria

La comprobación manual sigue siendo necesaria cuando el comportamiento depende de:

- Sesión real de usuario.
- OAuth o permisos de proveedor conectado.
- Supabase remoto o datos reales.
- Confirmaciones antes de guardar cambios.
- Vistas complejas de sincronización, contactos, dashboard, objetivos, cuenta o sistema.
- Estados visuales responsivos desktop/mobile.
- Operaciones destructivas o de alto impacto.

## CI y automatización

No se observó carpeta `.github` ni workflow de GitHub Actions en el repositorio. Por lo tanto, no debe asumirse que las validaciones corren automáticamente al hacer commit o push.

Hasta que exista CI, cada cambio relevante debe declarar qué validación se ejecutó y qué quedó sin validar.

## Gaps conocidos

- No existe comando global `npm test`.
- No existe lint script observado.
- No existe suite E2E o de navegador observada.
- No existe prueba visual automatizada observada.
- No existe reporte de cobertura observado.
- No existe harness automatizado de SQL/RLS observado.
- `objectiveMetrics.test.ts` no aparece integrado en scripts npm.
- No hay evidencia de CI activo.
