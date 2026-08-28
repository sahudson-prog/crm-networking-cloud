-- CRM Networking cloud seed: headhunter company master v0.1
-- Purpose: populate the headhunter company master from reliable existing CRM data.
--
-- This query writes to:
-- - public.headhunter_companies
-- - public.headhunter_company_domains
--
-- Reliability rule:
-- - uses active contacts marked as headhunter;
-- - requires a non-empty company;
-- - uses corporate domains from contact emails and manual headhunter domains;
-- - excludes personal/free email domains;
-- - excludes domains that point to more than one company;
-- - safe to rerun: unique indexes avoid duplicates.

with target_user as (
  select c.user_id
  from public.contacts c
  group by c.user_id
  order by count(*) desc
  limit 1
),
free_email_domains(normalized_domain) as (
  values
    ('@gmail.com'),
    ('@googlemail.com'),
    ('@hotmail.com'),
    ('@outlook.com'),
    ('@live.com'),
    ('@msn.com'),
    ('@icloud.com'),
    ('@me.com'),
    ('@mac.com'),
    ('@yahoo.com'),
    ('@yahoo.es'),
    ('@ymail.com'),
    ('@aol.com'),
    ('@proton.me'),
    ('@protonmail.com')
),
headhunter_contacts as (
  select
    c.user_id,
    c.id as contact_id,
    c.display_name,
    btrim(c.company) as display_name_company,
    lower(regexp_replace(btrim(c.company), '\s+', ' ', 'g')) as normalized_company,
    c.headhunter_domains
  from public.contacts c
  join target_user t on t.user_id = c.user_id
  where c.is_active = true
    and c.is_headhunter = true
    and btrim(c.company) <> ''
    and lower(btrim(c.company)) not in ('empresa', 'sin empresa', 'sin datos', 'sin dato')
),
email_domains as (
  select
    hc.user_id,
    hc.contact_id,
    hc.display_name,
    hc.display_name_company,
    hc.normalized_company,
    '@' || lower(regexp_replace(coalesce(nullif(ce.domain, ''), split_part(ce.normalized_email, '@', 2)), '^@+', '')) as normalized_domain
  from headhunter_contacts hc
  join public.contact_emails ce on ce.contact_id = hc.contact_id and ce.user_id = hc.user_id
  where coalesce(nullif(ce.domain, ''), split_part(ce.normalized_email, '@', 2)) <> ''
),
manual_domains as (
  select
    hc.user_id,
    hc.contact_id,
    hc.display_name,
    hc.display_name_company,
    hc.normalized_company,
    '@' || lower(regexp_replace(domain_value, '^@+', '')) as normalized_domain
  from headhunter_contacts hc
  cross join lateral unnest(hc.headhunter_domains) as domain_value
  where btrim(domain_value) <> ''
),
raw_domains as (
  select * from email_domains
  union all
  select * from manual_domains
),
clean_domains as (
  select distinct
    rd.user_id,
    rd.contact_id,
    rd.display_name,
    rd.display_name_company,
    rd.normalized_company,
    rd.normalized_domain
  from raw_domains rd
  where rd.normalized_domain ~ '^@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$'
),
domain_company_stats as (
  select
    cd.normalized_domain,
    count(distinct cd.normalized_company) as company_count
  from clean_domains cd
  left join free_email_domains free on free.normalized_domain = cd.normalized_domain
  where free.normalized_domain is null
  group by cd.normalized_domain
),
usable_domains as (
  select cd.*
  from clean_domains cd
  join domain_company_stats stats on stats.normalized_domain = cd.normalized_domain
  left join free_email_domains free on free.normalized_domain = cd.normalized_domain
  where free.normalized_domain is null
    and stats.company_count = 1
),
company_candidates as (
  select
    hc.user_id,
    min(hc.display_name_company) as display_name,
    hc.normalized_company,
    count(distinct hc.contact_id) as contact_count
  from headhunter_contacts hc
  group by hc.user_id, hc.normalized_company
),
inserted_companies as (
  insert into public.headhunter_companies (
    display_name,
    normalized_name,
    notes
  )
  select
    cc.display_name,
    cc.normalized_company,
    'Creada desde contactos marcados como headhunter; revisar y ajustar si corresponde.' as notes
  from company_candidates cc
  on conflict do nothing
  returning id, display_name, normalized_name
),
master_companies as (
  select id, display_name, normalized_name
  from inserted_companies
  union all
  select hc.id, hc.display_name, hc.normalized_name
  from public.headhunter_companies hc
  where hc.is_active = true
),
domain_candidates as (
  select distinct
    mc.id as company_id,
    ud.normalized_domain
  from usable_domains ud
  join master_companies mc
    on mc.normalized_name = ud.normalized_company
),
inserted_domains as (
  insert into public.headhunter_company_domains (
    company_id,
    domain,
    normalized_domain,
    is_primary
  )
  select
    dc.company_id,
    dc.normalized_domain,
    dc.normalized_domain,
    false
  from domain_candidates dc
  on conflict do nothing
  returning id, company_id, normalized_domain
),
summary(resultado, valor) as (
  select
    'empresas_candidatas',
    (select count(*)::text from company_candidates)

  union all

  select
    'empresas_creadas',
    (select count(*)::text from inserted_companies)

  union all

  select
    'dominios_candidatos_confiables',
    (select count(*)::text from domain_candidates)

  union all

  select
    'dominios_creados',
    (select count(*)::text from inserted_domains)

  union all

  select
    'dominios_ambiguos_no_cargados',
    (select count(*)::text from domain_company_stats where company_count > 1)
)
select
  resultado,
  valor
from summary
order by resultado;
