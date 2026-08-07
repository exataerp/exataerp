-- Migration historica ja aplicada em homologacao. O estado sensivel de
-- autenticacao permanece fora de public e e criado pela migration seguinte.

alter table public.perfis
  add column if not exists username text;

with base as (
  select
    id,
    case
      when length(
        trim(both '._-' from regexp_replace(
          lower(coalesce(nullif(split_part(email, '@', 1), ''), nullif(nome, ''), 'usuario')),
          '[^a-z0-9._-]+',
          '',
          'g'
        ))
      ) >= 3
      then left(
        trim(both '._-' from regexp_replace(
          lower(coalesce(nullif(split_part(email, '@', 1), ''), nullif(nome, ''), 'usuario')),
          '[^a-z0-9._-]+',
          '',
          'g'
        )),
        40
      )
      else 'usuario-' || left(replace(id::text, '-', ''), 8)
    end as base_username
  from public.perfis
  where username is null
), ranked as (
  select
    id,
    base_username,
    count(*) over (partition by base_username) as duplicates
  from base
), proposed as (
  select
    id,
    case
      when duplicates = 1 then base_username
      else left(base_username, 31) || '-' || left(replace(id::text, '-', ''), 8)
    end as username
  from ranked
)
update public.perfis as perfil
set username = proposed.username
from proposed
where perfil.id = proposed.id;

alter table public.perfis
  alter column username set not null;

alter table public.perfis
  drop constraint if exists perfis_username_formato_check;

alter table public.perfis
  add constraint perfis_username_formato_check
  check (username ~ '^[a-z0-9][a-z0-9._-]{2,39}$');

create unique index if not exists perfis_username_lower_key
  on public.perfis (lower(username));

comment on column public.perfis.username is
  'Identificador publico e global usado no login; normalizado em minusculas.';
