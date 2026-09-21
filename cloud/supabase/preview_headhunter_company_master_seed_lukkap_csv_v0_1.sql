-- CRM Networking cloud preview: Lukkap headhunter list seed v0.1
-- Source file reviewed locally: Listado Headhunters Lukkap Chile.csv
-- Purpose: review additional reliable company/domain candidates before populating the master.
-- This query does not write data.
--
-- Rule:
-- - source company comes from the CSV EMPRESA column;
-- - domain comes from corporate email domains found in the CSV;
-- - personal/free email domains were excluded while preparing this candidate list;
-- - ambiguous domains were excluded from automatic insertion and are shown as review items.

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
existing_companies as (
  select normalized_name
  from public.headhunter_companies
  where is_active = true
),
existing_domains as (
  select
    hcd.normalized_domain,
    hc.display_name as existing_company
  from public.headhunter_company_domains hcd
  join public.headhunter_companies hc on hc.id = hcd.company_id
  where hcd.is_active = true
    and hc.is_active = true
),
preview_rows(categoria_revision, empresa, dominio, observacion) as (
  select
    '01_candidatos_lukkap',
    np.display_name,
    np.normalized_domain,
    case
      when ec.normalized_name is not null and ed.normalized_domain is not null then 'empresa y dominio ya existen'
      when ec.normalized_name is not null then 'empresa existe; se puede agregar dominio'
      when ed.normalized_domain is not null then 'dominio ya existe en maestro: ' || ed.existing_company
      else 'se puede crear empresa/dominio'
    end as note
  from normalized_pairs np
  left join existing_companies ec on ec.normalized_name = np.normalized_name
  left join existing_domains ed on ed.normalized_domain = np.normalized_domain
)
select
  categoria_revision,
  empresa,
  dominio,
  observacion
from preview_rows
order by categoria_revision, empresa, dominio;
