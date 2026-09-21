-- CRM Networking cloud fix: consolidate Mandomedio in headhunter master v0.1
-- Purpose: keep exactly one active master company for @mandomedio.com: "Mandomedio".
--
-- This query writes to:
-- - public.headhunter_companies
-- - public.headhunter_company_domains
--
-- It is safe to rerun.

with ensure_company as (
  insert into public.headhunter_companies (
    display_name,
    normalized_name,
    notes,
    is_active
  )
  select
    'Mandomedio',
    'mandomedio',
    'Empresa consolidada para @mandomedio.com.',
    true
  on conflict do nothing
  returning id
),
target_company as (
  select id
  from public.headhunter_companies
  where normalized_name = 'mandomedio'
    and is_active = true
  order by updated_at desc
  limit 1
),
candidate_companies as (
  select id, display_name, normalized_name
  from public.headhunter_companies
  where (
      normalized_name in ('mandomedio', 'mando medio', 'insigni - mandomedio')
      or id in (
        select company_id
        from public.headhunter_company_domains
        where normalized_domain = '@mandomedio.com'
      )
    )
),
ensure_domain as (
  insert into public.headhunter_company_domains (
    company_id,
    domain,
    normalized_domain,
    is_primary,
    is_active
  )
  select
    tc.id,
    '@mandomedio.com',
    '@mandomedio.com',
    true,
    true
  from target_company tc
  on conflict do nothing
  returning id
),
deactivate_duplicate_domains as (
  update public.headhunter_company_domains hcd
     set is_active = false,
         updated_at = now()
  from candidate_companies cc, target_company tc
  where hcd.company_id = cc.id
    and hcd.normalized_domain = '@mandomedio.com'
    and hcd.company_id <> tc.id
    and hcd.is_active = true
  returning hcd.id
),
deactivate_duplicate_companies as (
  update public.headhunter_companies hc
     set is_active = false,
         notes = btrim(concat_ws(E'\n', nullif(hc.notes, ''), 'Consolidada en Mandomedio para @mandomedio.com.')),
         updated_at = now()
  from candidate_companies cc, target_company tc
  where hc.id = cc.id
    and hc.id <> tc.id
    and hc.is_active = true
  returning hc.id
),
summary(resultado, valor) as (
  select 'empresa_activa_final', (select 'Mandomedio')
  union all
  select 'dominio_activo_final', (select '@mandomedio.com')
  union all
  select 'dominios_duplicados_desactivados', (select count(*)::text from deactivate_duplicate_domains)
  union all
  select 'empresas_duplicadas_desactivadas', (select count(*)::text from deactivate_duplicate_companies)
)
select resultado, valor
from summary
order by resultado;
