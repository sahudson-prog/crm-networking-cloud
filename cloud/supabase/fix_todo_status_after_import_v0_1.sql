-- Corrige una importacion v0.1 donde los ToDos legacy con Estado_ToDo = 'Pendiente'
-- quedaron como dismissed en Supabase. No toca contactos, interacciones ni sugerencias
-- completadas.

with target_user as (
  select '674317f4-44d6-4311-8460-ecade3ec3620'::uuid as user_id
)
update public.todos t
set
  status = 'active',
  resolved_at = null,
  updated_at = now()
from target_user u
where t.user_id = u.user_id
  and t.status = 'dismissed'
  and t.todo_type = 'NETWORKING_STATUS_CHANGE'
  and coalesce(t.legacy_todo_id, '') <> 'TODO_920e4bb1833a9b0a';

with target_user as (
  select '674317f4-44d6-4311-8460-ecade3ec3620'::uuid as user_id
)
update public.todos t
set
  status = 'done',
  resolved_at = coalesce(t.resolved_at, t.updated_at, now()),
  updated_at = now()
from target_user u
where t.user_id = u.user_id
  and t.legacy_todo_id = 'TODO_920e4bb1833a9b0a';

with target_user as (
  select '674317f4-44d6-4311-8460-ecade3ec3620'::uuid as user_id
)
select
  t.status,
  count(*) as total
from public.todos t
join target_user u on t.user_id = u.user_id
group by t.status
order by t.status;
