alter table public.empresas
  add column if not exists subdomain text;

with generated as (
  select
    id,
    case id
      when '00000000-0000-0000-0000-000000000001'::uuid then 'forza'
      when 'c39a6444-8aaa-4bd6-98c0-03ec43367f9e'::uuid then 'mairo'
      else left(
        trim(both '-' from regexp_replace(
          translate(
            lower(coalesce(nullif(nome_fantasia, ''), nome)),
            'áàâãäéèêëíìîïóòôõöúùûüçñ',
            'aaaaaeeeeiiiiooooouuuucn'
          ),
          '[^a-z0-9]+',
          '-',
          'g'
        )),
        63
      )
    end as base_subdomain
  from public.empresas
  where subdomain is null
), normalized as (
  select
    id,
    case
      when char_length(base_subdomain) < 2
        or base_subdomain in ('admin', 'api', 'app', 'homologacao', 'www')
      then 'empresa-' || left(replace(id::text, '-', ''), 8)
      else base_subdomain
    end as base_subdomain
  from generated
), ranked as (
  select
    id,
    base_subdomain,
    count(*) over (partition by base_subdomain) as duplicates
  from normalized
)
update public.empresas as empresa
set subdomain = case
  when ranked.duplicates = 1 then ranked.base_subdomain
  else left(ranked.base_subdomain, 54) || '-' || left(replace(ranked.id::text, '-', ''), 8)
end
from ranked
where empresa.id = ranked.id;

alter table public.empresas
  alter column subdomain set not null;

alter table public.empresas
  drop constraint if exists empresas_subdomain_formato_check;

alter table public.empresas
  add constraint empresas_subdomain_formato_check
  check (
    subdomain = lower(btrim(subdomain))
    and char_length(subdomain) between 2 and 63
    and subdomain ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'
    and subdomain not in ('admin', 'api', 'app', 'homologacao', 'www')
  );

create unique index if not exists empresas_subdomain_lower_key
  on public.empresas (lower(subdomain));

comment on column public.empresas.subdomain is
  'Identificador DNS exclusivo do tenant sob o domínio raiz do Exata ERP.';
