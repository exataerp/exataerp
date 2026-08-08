do $$
begin
  if (select count(*) from public.super_admins) <> 1 then
    raise exception 'expected exactly one canonical super admin';
  end if;
end
$$;

create unique index if not exists super_admins_singleton_key
  on public.super_admins ((true));

delete from public.controle_acesso ca
where ca.nivel = 'master'
  and not exists (
    select 1
    from public.super_admins sa
    where sa.user_id = ca.user_id
  );

create or replace function private.pode_gerenciar_perfil(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.super_admins sa
      where sa.user_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.controle_acesso ca
      where ca.user_id = (select auth.uid())
        and ca.empresa_id = p_empresa_id
        and ca.nivel = 'admin'
        and ca.status = 'ativo'
    );
$$;

create or replace function public.is_master()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.super_admins sa
    where sa.user_id = (select auth.uid())
  );
$$;

revoke all on function private.pode_gerenciar_perfil(uuid) from public;
grant execute on function private.pode_gerenciar_perfil(uuid)
  to authenticated, service_role;

revoke all on function public.is_master() from public;
grant execute on function public.is_master()
  to authenticated, service_role;

alter table public.super_admins enable row level security;

drop policy if exists super_admins_server_only on public.super_admins;
create policy super_admins_server_only
on public.super_admins
for all
to anon, authenticated
using (false)
with check (false);

revoke all on table public.super_admins from anon, authenticated;
grant select, insert, update, delete on table public.super_admins to service_role;

comment on table public.super_admins is
  'Fonte canônica server-side do único superadministrador global do Exata ERP.';
