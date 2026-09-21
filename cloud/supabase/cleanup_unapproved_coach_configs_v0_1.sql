-- Limpia configuraciones del Coach que fueron sembradas como ideas futuras.
-- Solo quedan configurables las reglas aprobadas e implementadas.

begin;

with removed_configs as (
  delete from public.todo_configs config
  where config.todo_type not in (
    'RULE_STATUS_TO_CONTACTED',
    'RULE_STATUS_TO_SCHEDULED',
    'RULE_STATUS_TO_MEETING_DONE',
    'RULE_STATUS_TO_THANK_YOU',
    'HEADHUNTER_COMPANY_DETECTED'
  )
  returning config.id
),
closed_todos as (
  update public.todos todo
  set
    status = 'expired',
    resolved_at = coalesce(todo.resolved_at, now()),
    reason = 'Cerrada por limpieza: tipo de sugerencia Coach no aprobado para MVP.',
    updated_at = now()
  where todo.status = 'active'
    and todo.todo_type not in (
      'NETWORKING_STATUS_CHANGE',
      'HEADHUNTER_COMPANY_DETECTED'
    )
  returning todo.id
)
select
  (select count(*) from removed_configs) as configuraciones_no_aprobadas_eliminadas,
  (select count(*) from closed_todos) as sugerencias_activas_no_aprobadas_cerradas,
  (select count(*) from public.todo_configs) as configuraciones_coach_restantes,
  (select count(*) from public.todos where status = 'active') as sugerencias_activas_restantes;

commit;
