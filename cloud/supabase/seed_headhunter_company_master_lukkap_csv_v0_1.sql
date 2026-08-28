-- CRM Networking cloud seed: Lukkap headhunter list v0.1
-- Source file reviewed locally: Listado Headhunters Lukkap Chile.csv
-- Purpose: add reliable company/domain pairs to the headhunter company master.
--
-- This query writes to:
-- - public.headhunter_companies
-- - public.headhunter_company_domains
--
-- Safe to rerun. Existing companies/domains are skipped by unique indexes.
-- Ambiguous source domains are intentionally excluded.

with source_pairs(display_name, normalized_domain) as (
  values
    ('ACKERMANN', '@ackermanninternational.com'),
    ('AD Consulting', '@adconsulting.cl'),
    ('Aktion Advisors', '@aktionadvisors.com'),
    ('Allot', '@allot.cl'),
    ('Altalinea', '@altalinea.cl'),
    ('Alto Impacto', '@getailatam.com'),
    ('Bigmond Executive Search', '@bigmond.com'),
    ('ByG Talent', '@bygtalent.cl'),
    ('C Group', '@c-group.cl'),
    ('CF + Partners', '@cfpartners.cl'),
    ('Contacto Humano BG', '@contactohumanobg.com'),
    ('De la Sotta Consultores', '@delasottaconsultores.com'),
    ('Downing Teal', '@downingteal.cl'),
    ('Egon Zehnder', '@egonzehnder.com'),
    ('Equation Partners', '@eqp.cl'),
    ('Equation Partners', '@equationpartners.cl'),
    ('Focus Advisors', '@focusadvisor.cl'),
    ('Gen Consultores', '@gen-consultores.cl'),
    ('Golden Search', '@goldensearch.cl'),
    ('GDAHeadhunter', '@headhunter.cl'),
    ('Grupo Avanza', '@grupoavanza.com'),
    ('Grupo Cinco', '@grupocinco.cl'),
    ('Grupo SDH', '@sdh.cl'),
    ('Hemisferio Izquierdo', '@hemisferio.cl'),
    ('HKHumancapital', '@hkhumancapital.cl'),
    ('HO Partners', '@hopartners.cl'),
    ('HR Trust', '@hrtrust.cl'),
    ('Humanitas Chile', '@humanitaschile.com'),
    ('Huntme', '@huntme.cl'),
    ('Icaran', '@icaran.cl'),
    ('Idealis', '@idealis.cl'),
    ('Inquest Chile Consultores', '@inquest.cl'),
    ('Intertrust', '@intertrust.cl'),
    ('IT Hunters', '@it-hunter.cl'),
    ('Kingsley Gate Partners', '@kingsleygate.com'),
    ('Know-How Partners', '@khp.cl'),
    ('Korn Ferry', '@kornferry.com'),
    ('Luminis Consejeros', '@luminis.cl'),
    ('Mandomedio', '@mandomedio.com'),
    ('Michael Page', '@michaelpage.cl'),
    ('MV Amrop', '@amrop.cl'),
    ('Odgers Berndtson', '@odgeresberndtson.cl'),
    ('Odgers Berndtson', '@odgersberndtson.com'),
    ('One Match', '@onematch.cl'),
    ('Optima Consultores', '@optimaconsultores.cl'),
    ('Page Executive', '@pageexecutive.com'),
    ('PB Talentos', '@pbtalentos.com'),
    ('Perfil Consultores', '@perfilconsultores.cl'),
    ('Robert Walters', '@robertwalters.com'),
    ('Seminarium', '@seminarium.cl'),
    ('SomosTribus', '@somostribus.cl'),
    ('Spencer Stuart', '@spencerstuart.com'),
    ('Stanton Chase', '@stantonchase.com'),
    ('Stratos Executive Search', '@stratos.cl'),
    ('TailorMade', '@tailormade.cl'),
    ('Talent Acquisition (finder)', '@talentfinder.cl'),
    ('Talent Partner', '@talentpartners.cl'),
    ('Talent Search', '@talentsearchchile.cl'),
    ('TCS Group', '@tcsgroup.cl'),
    ('Testanova', '@testanova.com'),
    ('Transearch', '@transearch.com'),
    ('Triaz Head Hunters', '@triaz.cl'),
    ('WeTalent', '@wetalent.cl'),
    ('Youlton & Ganderats', '@y-g.cl')
),
normalized_pairs as (
  select
    btrim(display_name) as display_name,
    lower(regexp_replace(btrim(display_name), '\s+', ' ', 'g')) as normalized_name,
    lower(btrim(normalized_domain)) as normalized_domain
  from source_pairs
),
company_candidates as (
  select
    min(display_name) as display_name,
    normalized_name
  from normalized_pairs
  group by normalized_name
),
inserted_companies as (
  insert into public.headhunter_companies (
    display_name,
    normalized_name,
    notes
  )
  select
    cc.display_name,
    cc.normalized_name,
    'Creada desde Listado Headhunters Lukkap Chile; revisar y ajustar si corresponde.' as notes
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
    np.normalized_domain
  from normalized_pairs np
  join master_companies mc
    on mc.normalized_name = np.normalized_name
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
  select 'pares_fuente_lukkap', (select count(*)::text from normalized_pairs)
  union all
  select 'empresas_candidatas', (select count(*)::text from company_candidates)
  union all
  select 'empresas_creadas', (select count(*)::text from inserted_companies)
  union all
  select 'dominios_candidatos', (select count(*)::text from domain_candidates)
  union all
  select 'dominios_creados', (select count(*)::text from inserted_domains)
  union all
  select 'dominios_ambiguos_excluidos', '0'
)
select
  resultado,
  valor
from summary
order by resultado;
