-- O Supabase Auth autentica por e-mail ou telefone. O Exata mantém essa
-- credencial técnica somente no servidor e expõe um nome de usuário estável.
-- A unicidade é global porque a tela de login não solicita a empresa.

alter table public.perfis
  add column if not exists username text,
  add column if not exists must_change_password boolean not null default false,
  add column if not exists password_changed_at timestamp with time zone,
  add column if not exists password_reset_required_at timestamp with time zone,
  add column if not exists password_reset_by uuid;

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

alter table public.perfis
  drop constraint if exists perfis_troca_senha_consistente_check;

alter table public.perfis
  add constraint perfis_troca_senha_consistente_check
  check (
    not must_change_password
    or password_reset_required_at is not null
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'perfis_password_reset_by_fkey'
      and conrelid = 'public.perfis'::regclass
  ) then
    alter table public.perfis
      add constraint perfis_password_reset_by_fkey
      foreign key (password_reset_by)
      references auth.users(id)
      on delete set null;
  end if;
end;
$$;

create unique index if not exists perfis_username_lower_key
  on public.perfis (lower(username));

comment on column public.perfis.username is
  'Identificador público e global usado no login; normalizado em minúsculas.';

comment on column public.perfis.must_change_password is
  'Bloqueia o acesso ao ERP até que o usuário substitua a senha temporária.';

comment on column public.perfis.password_changed_at is
  'Data da última alteração de senha concluída pelo próprio usuário.';

comment on column public.perfis.password_reset_required_at is
  'Data em que uma senha temporária passou a exigir troca obrigatória.';

comment on column public.perfis.password_reset_by is
  'Administrador que definiu a senha temporária; não armazena a senha.';
