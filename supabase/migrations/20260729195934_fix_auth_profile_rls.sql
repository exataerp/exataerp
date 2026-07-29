-- Remove a recursão nas políticas de perfis e mantém a autorização
-- administrativa fora do schema exposto pela Data API.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create or replace function private.pode_gerenciar_perfil(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.controle_acesso ca
    where ca.user_id = (select auth.uid())
      and ca.status = 'ativo'
      and (
        ca.nivel = 'master'
        or (ca.nivel = 'admin' and ca.empresa_id = p_empresa_id)
      )
  );
$$;

revoke all on function private.pode_gerenciar_perfil(uuid) from public;
grant execute on function private.pode_gerenciar_perfil(uuid)
  to authenticated, service_role;

drop policy if exists "perfis: admin gerencia" on public.perfis;
drop policy if exists "perfis: admin vê todos" on public.perfis;
drop policy if exists "perfis_admin_mesma_empresa" on public.perfis;

create policy "perfis_admin_mesma_empresa"
on public.perfis
for all
to authenticated
using ((select private.pode_gerenciar_perfil(empresa_id)))
with check ((select private.pode_gerenciar_perfil(empresa_id)));

-- Super Admin é uma identidade global. O vínculo em super_admins é a fonte
-- canônica, com controle_acesso como compatibilidade para o modelo legado.
create or replace function public.is_master()
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
        and ca.nivel = 'master'
        and ca.status = 'ativo'
    );
$$;

create or replace function public.get_empresa_do_usuario()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.empresa_id
  from public.perfis p
  where p.user_id = (select auth.uid())
     or p.id = (select auth.uid())
  order by (p.user_id = (select auth.uid())) desc
  limit 1;
$$;

revoke all on function public.is_master() from public;
revoke all on function public.get_empresa_do_usuario() from public;
revoke all on function public.get_meu_perfil(uuid) from public;
revoke all on function public.tem_acesso_empresa(uuid) from public;

grant execute on function public.is_master()
  to authenticated, service_role;
grant execute on function public.get_empresa_do_usuario()
  to authenticated, service_role;
grant execute on function public.get_meu_perfil(uuid)
  to authenticated, service_role;
grant execute on function public.tem_acesso_empresa(uuid)
  to authenticated, service_role;

alter function public.get_meu_perfil(uuid)
  set search_path = pg_catalog, public;

alter view public.v_user_roles set (security_invoker = true);

-- Repara usuários já vinculados a perfis/roles que não receberam a linha
-- legada de controle_acesso. A operação é idempotente.
insert into public.controle_acesso (
  user_id,
  empresa_id,
  nivel,
  status,
  activated_at
)
select
  p.user_id,
  p.empresa_id,
  case
    when sa.user_id is not null then 'master'
    when bool_or(r.name = 'system_manager') then 'admin'
    else 'operador'
  end,
  'ativo',
  now()
from public.perfis p
join auth.users au on au.id = p.user_id
left join public.super_admins sa on sa.user_id = p.user_id
left join public.user_roles ur
  on ur.user_id = p.user_id
 and ur.empresa_id = p.empresa_id
left join public.roles r on r.id = ur.role_id
where p.user_id is not null
  and p.empresa_id is not null
  and not exists (
    select 1
    from public.controle_acesso ca
    where ca.user_id = p.user_id
      and ca.empresa_id = p.empresa_id
  )
group by p.user_id, p.empresa_id, sa.user_id;
