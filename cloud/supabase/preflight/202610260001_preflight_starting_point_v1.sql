-- Read-only preflight for OBJ-02 R1. Returns aggregate diagnostics without user identifiers or values.

begin transaction read only;

with networking_values as (
  select
    case
      when pg_catalog.btrim(coalesce(setting.setting_value, '')) ~ '^\d{4}-\d{2}-\d{2}$'
        then pg_catalog.btrim(setting.setting_value)
      when pg_catalog.btrim(coalesce(setting.setting_value, '')) ~ '^\d{1,2}/\d{1,2}/\d{4}$'
        then pg_catalog.split_part(pg_catalog.btrim(setting.setting_value), '/', 3)
          || '-' || pg_catalog.lpad(pg_catalog.split_part(pg_catalog.btrim(setting.setting_value), '/', 2), 2, '0')
          || '-' || pg_catalog.lpad(pg_catalog.split_part(pg_catalog.btrim(setting.setting_value), '/', 1), 2, '0')
      else null
    end as date_candidate
  from public.user_settings setting
  where setting.setting_key = 'Fecha_Inicio_Networking'
), networking_diagnostics as (
  select
    count(*) as total_rows,
    count(*) filter (
      where date_candidate is null
        or not pg_catalog.pg_input_is_valid(date_candidate, 'date')
        or case
          when pg_catalog.pg_input_is_valid(date_candidate, 'date')
            then date_candidate::date > (pg_catalog.statement_timestamp() at time zone 'UTC')::date
          else false
        end
    ) as incompatible_rows
  from networking_values
), constraint_diagnostics as (
  select
    constraint_row.contype,
    constraint_row.convalidated,
    pg_catalog.regexp_replace(
      pg_catalog.lower(pg_catalog.pg_get_constraintdef(constraint_row.oid, true)),
      '[[:space:]]+', ' ', 'g'
    ) as normalized_definition
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = 'public.profiles'::regclass
    and constraint_row.conname = 'profiles_professional_situation_code_valid'
), diagnostics as (
  select
    networking_diagnostics.total_rows,
    networking_diagnostics.incompatible_rows,
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'profiles'
        and column_name = 'professional_situation_code'
        and data_type = 'text'
        and is_nullable = 'YES'
    ) as compatible_column_exists,
    exists (select 1 from constraint_diagnostics) as constraint_exists,
    coalesce((select contype = 'c' and convalidated and normalized_definition =
      'check (professional_situation_code is null or (professional_situation_code = any (array[''employed''::text, ''unemployed''::text, ''independent''::text, ''studying''::text, ''other''::text, ''prefer_not_to_say''::text])))'
      from constraint_diagnostics), false) as compatible_constraint_exists
  from networking_diagnostics
)
select jsonb_build_object(
  'networking_start_rows', total_rows,
  'incompatible_networking_start_rows', incompatible_rows,
  'professional_situation_column_exists', compatible_column_exists,
  'professional_situation_constraint_exists', constraint_exists,
  'professional_situation_constraint_compatible', compatible_constraint_exists,
  'stop_reasons', jsonb_strip_nulls(jsonb_build_object(
    'incompatible_networking_start_rows', case when incompatible_rows > 0 then incompatible_rows end,
    'incompatible_professional_situation_contract', case
      when constraint_exists and not compatible_constraint_exists then true
      when compatible_column_exists <> constraint_exists then true
    end
  ))
) as starting_point_v1_preflight
from diagnostics;

rollback;
