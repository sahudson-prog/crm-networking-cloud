# OBJ-02 R1 DEV cutover

Este procedimiento aplica exclusivamente a Supabase DEV `wwlbxrdnrojqkhdxkzdx`. No autoriza SQL remoto por sí mismo ni aplica a PROD.

## Artefactos y orden

1. `preflight/202610260001_preflight_starting_point_v1.sql`.
2. `operations/dev/202610260001_capture_starting_point_v1.sql`.
3. `migrations/202610260001_starting_point_v1.sql`.
4. `verifiers/202610260001_verify_starting_point_v1.sql`.
5. `verifiers/202610260001_verify_starting_point_v1_behavior.sql`.
6. `verifiers/202610260001_verify_access_starting_point_composed.sql`.

Ejecutar cada archivo completo y en una operación separada. Verificar ruta y SHA-256 contra el checkpoint aprobado antes de copiarlo al SQL Editor.

## Gate 1: preflight

El preflight es `READ ONLY`, no devuelve filas de aplicación ni identificadores de usuario y termina en `ROLLBACK`.

- `installation_state` debe ser `clean_install`, `compatible_partial` o `compatible_contract`.
- `stop_reasons` debe ser `{}`.
- `incompatible_networking_start_rows` debe ser `0`.
- Toda columna, constraint, función o trigger existente debe aparecer como compatible.
- `unexpected_overloads` y `unexpected_dependents` deben estar vacíos.

Ante cualquier diferencia, `STOP`. No corregir datos ni catálogo durante el cutover.

## Gate 2: captura estructural

La captura es `READ ONLY`, cubre únicamente la columna/constraint, las tres funciones R1, el trigger y owner/RLS/ACL de `profiles` y `user_settings`. Guardar el único JSON fuera de Git junto con su `payload_md5`, `payload_bytes`, project ref y fecha de ejecución.

La captura no contiene datos de aplicación y no es un backup. Sirve para demostrar el estado previo y diseñar un forward-fix si un verifier detecta una diferencia inesperada.

Si DEV contiene datos irremplazables o una pérdida del ambiente no es aceptable, `STOP` y solicitar un backup lógico fresco con restauración ensayada. No asumir que DEV es descartable ni que PITR está disponible.

## Gate 3: migration

La migration es transaccional. Sus precondiciones se ejecutan antes del primer DDL y aceptan solo objetos ausentes o compatibles. No transforma filas ni hace backfill.

- Un fallo de precondición o DDL revierte la transacción completa.
- No desplegar el runtime R1 antes de que la migration y los tres verifiers pasen.
- El runtime anterior permanece compatible con el schema expandido.

## Gate 4: verificación

El verifier estructural y el compuesto son read-only. El verifier comportamental usa fixtures sintéticas dentro de una transacción que termina en `ROLLBACK`.

Si cualquier verifier falla después del commit de la migration:

1. `STOP` y conservar el runtime anterior.
2. Guardar error, captura previa y diagnóstico agregado.
3. Preparar una migration forward-only o repetir la misma migration solo si el diagnóstico demuestra un estado compatible.
4. No eliminar columna, constraint, trigger ni funciones mediante un rollback improvisado.

## Recuperación proporcional

- **Antes de migration:** un fallo no cambia el ambiente.
- **Durante migration:** PostgreSQL revierte la transacción completa.
- **Después de migration, antes del runtime:** mantener el schema expandido y el runtime anterior; corregir mediante forward-fix si fuera necesario.
- **Después del runtime:** revertir el runtime al SHA anterior cuando sea compatible. Preservar `professional_situation_code` y los settings confirmados; no ejecutar `DROP` ni restaurar toda la base para corregir un fallo funcional focal.

PROD conserva un gate independiente de backup recuperable, recuperación ensayada y autorización específica.
