-- CRM Networking cloud preview: headhunter company master seed v0.1
-- Purpose: review reliable candidates before populating the headhunter company master.
-- This query does not write data.
--
-- Reliability rule:
-- - uses active contacts marked as headhunter;
-- - requires a non-empty company;
-- - uses corporate domains from contact emails and manual headhunter domains;
-- - excludes personal/free email domains;
-- - excludes domains that point to more than one company.

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
    '@' || lower(regexp_replace(coalesce(nullif(ce.domain, ''), split_part(ce.normalized_email, '@', 2)), '^@+', '')) as normalized_domain,
    'email' as source
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
    '@' || lower(regexp_replace(domain_value, '^@+', '')) as normalized_domain,
    'headhunter_domains' as source
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
    rd.normalized_domain,
    rd.source
  from raw_domains rd
  where rd.normalized_domain ~ '^@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$'
),
domain_company_stats as (
  select
    cd.normalized_domain,
    count(distinct cd.normalized_company) as company_count,
    array_agg(distinct cd.display_name_company order by cd.display_name_company) as company_names,
    count(distinct cd.contact_id) as contact_count
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
    count(distinct hc.contact_id) as contact_count,
    count(distinct ud.normalized_domain) as usable_domain_count,
    array_agg(distinct ud.normalized_domain order by ud.normalized_domain) filter (where ud.normalized_domain is not null) as domains
  from headhunter_contacts hc
  left join usable_domains ud on ud.contact_id = hc.contact_id and ud.user_id = hc.user_id
  group by hc.user_id, hc.normalized_company
),
domain_candidates as (
  select
    ud.user_id,
    ud.display_name_company as display_name,
    ud.normalized_company,
    ud.normalized_domain,
    count(distinct ud.contact_id) as contact_count
  from usable_domains ud
  group by ud.user_id, ud.display_name_company, ud.normalized_company, ud.normalized_domain
),
existing_companies as (
  select hc.normalized_name
  from public.headhunter_companies hc
  where hc.is_active = true
),
existing_domains as (
  select hcd.normalized_domain
  from public.headhunter_company_domains hcd
  where hcd.is_active = true
),
preview_rows(categoria_revision, empresa_o_dominio, dominios_o_empresa, contactos_detectados, dominios_detectados, observacion) as (
  select
    '01_empresas_candidatas',
    cc.display_name,
    coalesce(array_to_string(cc.domains, ', '), 'sin dominios confiables'),
    cc.contact_count,
    cc.usable_domain_count,
    case
      when ec.normalized_name is not null then 'ya existe en maestro'
      else 'se puede crear'
    end as note
  from company_candidates cc
  left join existing_companies ec on ec.normalized_name = cc.normalized_company

  union all

  select
    '02_dominios_candidatos',
    dc.normalized_domain,
    dc.display_name,
    dc.contact_count,
    1 as domain_count,
    case
      when ed.normalized_domain is not null then 'ya existe en maestro'
      else 'se puede asociar'
    end as note
  from domain_candidates dc
  left join existing_domains ed on ed.normalized_domain = dc.normalized_domain

  union all

  select
    '03_dominios_ambiguos_no_se_cargan',
    stats.normalized_domain,
    array_to_string(stats.company_names, ' | '),
    stats.contact_count,
    stats.company_count,
    'mismo dominio aparece con mas de una empresa; revisar manualmente' as note
  from domain_company_stats stats
  where stats.company_count > 1

  union all

  select
    '04_dominios_personales_no_se_cargan',
    cd.normalized_domain,
    array_to_string(array_agg(distinct cd.display_name_company order by cd.display_name_company), ' | '),
    count(distinct cd.contact_id)::integer as contact_count,
    1 as domain_count,
    'dominio personal/free email; no sirve como empresa headhunter' as note
  from clean_domains cd
  join free_email_domains free on free.normalized_domain = cd.normalized_domain
  group by cd.normalized_domain
)
select
  categoria_revision,
  empresa_o_dominio,
  dominios_o_empresa,
  contactos_detectados,
  dominios_detectados,
  observacion
from preview_rows
order by categoria_revision, empresa_o_dominio;
