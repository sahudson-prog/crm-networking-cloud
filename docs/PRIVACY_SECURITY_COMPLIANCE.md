# Privacidad, seguridad y cumplimiento

Este documento es el manual vivo para decisiones de privacidad, seguridad y cumplimiento de la app cloud. No reemplaza una revision legal formal; sirve para disenar, implementar y auditar la beta con una base ordenada.

## Fuentes normativas de referencia

- Chile, Ley 19.628 sobre proteccion de datos personales, version vigente y version con cambios diferidos: https://www.bcn.cl/leychile/navegar?idNorma=141599
- Chile, Ley 21.719, publicada el 13-12-2024, con entrada en vigencia principal el 01-12-2026: https://www.bcn.cl/leychile/navegar?i=1209272&f=2026-12-01
- Google API Services User Data Policy, para transparencia, uso limitado, seguridad y tratamiento de datos de usuario: https://developers.google.com/terms/api-services-user-data-policy
- Google OAuth 2.0 Best Practices, para autorizacion incremental, scopes minimos, manejo de tokens y revocacion: https://developers.google.com/identity/protocols/oauth2/resources/best-practices

## Criterios legales que afectan el diseno

### Datos personales

La app trata datos personales porque guarda o procesa informacion asociada a personas identificadas o identificables: nombres, correos, telefonos, empresa, cargo, interacciones, citas, mensajes, referidos, objetivos y actividad.

Regla de producto: todo dato privado debe pertenecer a un usuario y no puede quedar visible para otro usuario, una empresa patrocinadora o un administrador sin finalidad, permiso y alcance documentados.

### Finalidad

La finalidad principal es gestionar networking profesional del usuario: contactos, interacciones, seguimiento, objetivos, sugerencias y actividad asociada.

No se deben reutilizar datos personales para finalidades distintas, como reportes a terceros, entrenamiento, marketing o analitica identificable, sin consentimiento y explicacion separada.

### Minimizacion y proporcionalidad

La app debe pedir y guardar solo lo necesario para la funcionalidad activa. Para Google v1, los permisos son read-only y separados por tipo de dato: contactos, correos y calendario.

Regla de implementacion: no agregar scopes, tablas, logs o campos crudos "por si acaso" si no existe un uso claro, documentado y revisable.

### Transparencia y consentimiento

El usuario debe entender:

- Que cuenta usa para entrar a la app.
- Que cuentas externas tiene conectadas para importar datos.
- Que permisos entrego y para que se usan.
- Que datos fueron importados.
- Que acciones son manuales, sugeridas o automaticas.
- Como revocar una conexion o eliminar datos.

### Derechos del titular

La app debe prepararse para solicitudes de acceso, rectificacion, supresion, oposicion, portabilidad y bloqueo.

Implicancia de producto:

- Cuenta debe tener exportacion/portabilidad futura.
- Cuenta debe tener eliminacion o desactivacion con explicacion de impacto.
- Debe existir trazabilidad para saber que datos existen y de donde vienen.
- La supresion no debe borrar por accidente datos necesarios para auditoria minima, pero esos datos remanentes deben ser acotados y justificados.

### Seguridad y confidencialidad

La app debe proteger datos contra acceso no autorizado, perdida, filtracion, dano o uso indebido.

Baseline beta:

- HTTPS obligatorio en produccion.
- Supabase Auth para identidad.
- RLS en todas las tablas privadas.
- `user_id` obligatorio en datos privados.
- Service role key nunca en navegador.
- Secretos fuera de GitHub.
- Tokens OAuth no deben quedar expuestos en cliente.
- Logs sin datos personales innecesarios.
- Acceso admin real por roles/capabilities, no solo por ocultar botones.

### Datos sensibles y riesgo aumentado

La app no busca tratar datos sensibles. Sin embargo, correos, minutas o citas pueden contener datos sensibles escritos por el usuario o provenientes de fuentes externas.

Regla de diseno: tratar minutas, cuerpos de correo, descripciones de calendario y notas como contenido de alto cuidado, aunque el campo no este marcado formalmente como sensible.

### Decisiones automatizadas y Coach

El Coach puede sugerir o ejecutar acciones. Antes de beta amplia:

- Toda regla debe indicar condicion, evidencia, accion, tier minimo y modo de confirmacion.
- Las automatizaciones deben ser configurables y reversibles.
- Las acciones relevantes deben quedar en `action_invocations` y `audit_log`.
- No debe haber decisiones automatizadas con efecto relevante sin explicacion, opcion de revision humana y confirmacion cuando corresponda.

### Transferencias y encargados

Supabase, Vercel, Google y futuros proveedores actuan como infraestructura o fuentes externas. Antes de produccion deben quedar documentados como subprocesadores/encargados o integraciones conectadas, indicando finalidad y tipo de dato tratado.

## Implicancias para la arquitectura

### Identidad, perfil y conexiones

Separar tres capas:

- Cuenta de acceso: identidad para entrar a la app, basada en Supabase Auth.
- Perfil app: configuracion, rol, plan, estado y preferencias del usuario.
- Cuentas conectadas: Google, Microsoft, Apple u otros proveedores autorizados para importar datos.

Una cuenta Google puede servir para login y tambien para importar, pero la app debe tratarlas como permisos distintos.

### Roles, planes y capacidades

Usar un modelo mixto:

- RBAC para roles base: usuario, admin, soporte, admin de organizacion.
- Capabilities para acciones concretas: importar contactos, leer Gmail, leer Calendar, usar reglas Coach, autoejecutar reglas, exportar datos, acceder a mantencion.
- Entitlements para combinar plan personal, plan patrocinado, upgrade y permisos especiales.
- RLS para aislamiento real de datos privados.

Regla: no escribir logica comercial dispersa como `if plan === "pro"` en pantallas. La UI y las acciones deben consultar una matriz central de capacidades.

### Organizaciones y patrocinio

Una empresa puede patrocinar un plan de usuario, pero eso no le da acceso automatico a contactos, correos, minutas ni objetivos del usuario.

Cualquier reporte para empresa debe ser agregado, anonimizado o expresamente autorizado, con alcance separado.

### Logs y auditoria

Distinguir:

- `sync_run_logs`: diagnostico operativo de procesos.
- `audit_log`: cambios de negocio o seguridad.
- `usage_events`: consumo de cuotas/capacidades.
- Futuros `analytics_events`: analitica de producto con privacidad.

Los logs deben evitar exponer cuerpos de correos, minutas completas, tokens, telefonos o correos cuando no sean indispensables.

## Sprint de cuentas, usuarios y privacidad

### Objetivo

Dejar la app preparada para beta cerrada multiusuario: cada usuario entra, ve solo sus datos, conecta proveedores bajo permisos claros, opera dentro de su plan/capacidades y queda auditado sin exponer datos privados.

### Alcance del sprint

1. Auditar schema real de Supabase contra este manual.
2. Definir tablas definitivas de perfiles, roles, planes, capacidades, organizaciones y cuentas conectadas.
3. Convertir `connected_accounts` en fuente persistente de verdad para proveedor, email, scopes, estado y revocacion.
4. Crear resolvedor central de capacidades por usuario.
5. Proteger vistas y acciones sensibles desde backend/RLS, no solo UI.
6. Ordenar Cuenta para mostrar perfil, plan, conexiones, permisos y acciones delicadas.
7. Registrar eventos de seguridad, sync, cuota y cambios relevantes.
8. Validar con al menos dos usuarios de prueba.

### Fuera de alcance por ahora

- Billing real.
- App nativa.
- Exportar contactos hacia Google u otros proveedores.
- Reportes a empresas patrocinadoras con datos del usuario.
- IA leyendo minutas o correos sin reglas y consentimiento especificos.

### Criterios de cierre

- Usuario A no puede leer ni modificar datos del usuario B.
- Admin no depende de `NEXT_PUBLIC_ADMIN_EMAILS` como seguridad definitiva.
- Cuenta conectada muestra `conectado`, `permiso activo`, `permiso vencido`, `revocado` o `pausado` desde datos persistentes.
- Desconectar proveedor no elimina el login de la app salvo que sea la misma decision explicita de cuenta.
- Acciones sensibles quedan auditadas.
- Scopes Google activos son solo los necesarios y read-only en v1.
- Mantencion admin queda bloqueada para usuarios no autorizados desde servidor/policies.
- Logs de sync no exponen secretos ni contenido personal innecesario.
- El plan/capability decide acceso a importaciones, automatizaciones, limites y futuras exportaciones.

## Registro de seguimiento

| Fecha | Decision / hallazgo | Impacto | Estado |
|---|---|---|---|
| 2026-08-26 | Se crea manual vivo de privacidad, seguridad y cumplimiento como gate previo a multiusuario/beta. | El sprint de cuentas debe validar ley chilena, RLS, roles, capacidades, OAuth y logs antes de sumar usuarios reales. | En curso |
| 2026-08-27 | Se minimizan logs operativos y diagnosticos Calendar. | `sync_run_logs` redacta correos, telefonos, tokens y metadata sensible; `external_interaction_read_diagnostics` guarda resumen tecnico sin descripcion/cuerpo crudo. | Implementado en beta dev |
| 2026-08-27 | Se prepara preflight multiusuario no destructivo. | `verify_multiuser_readiness_v0_1.sql` revisa metadata de tablas privadas/globales, RLS/policies, resolvedor de capacidades y trigger antes de probar con dos usuarios reales. | Preparado |
