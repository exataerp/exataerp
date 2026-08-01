-- Apontamentos por posto de trabalho.
-- A tabela public.maquinas já é o cadastro de postos da Exata; por isso não
-- duplicamos o conceito de workstation. Esta migration só acrescenta vínculos
-- de acesso e uma associação N:N entre operações e postos.

create schema if not exists private;
revoke all on schema private from public;

create table if not exists public.usuario_postos_trabalho (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  maquina_id uuid not null references public.maquinas(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  primary key (empresa_id, user_id, maquina_id)
);

create table if not exists public.operacao_postos_trabalho (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  operacao_id uuid not null references public.operacoes(id) on delete cascade,
  maquina_id uuid not null references public.maquinas(id) on delete cascade,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (empresa_id, operacao_id, maquina_id)
);

create table if not exists public.equipes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null,
  descricao text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, nome)
);

create table if not exists public.equipe_membros (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  equipe_id uuid not null references public.equipes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (empresa_id, equipe_id, user_id)
);

create table if not exists public.equipe_postos_trabalho (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  equipe_id uuid not null references public.equipes(id) on delete cascade,
  maquina_id uuid not null references public.maquinas(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (empresa_id, equipe_id, maquina_id)
);

create index if not exists usuario_postos_trabalho_usuario_idx
  on public.usuario_postos_trabalho (empresa_id, user_id, maquina_id);
create index if not exists operacao_postos_trabalho_posto_idx
  on public.operacao_postos_trabalho (empresa_id, maquina_id, operacao_id) where ativo;
create index if not exists equipe_membros_usuario_idx
  on public.equipe_membros (empresa_id, user_id, equipe_id);
create index if not exists equipe_postos_posto_idx
  on public.equipe_postos_trabalho (empresa_id, equipe_id, maquina_id);
create unique index if not exists apontamentos_um_ativo_por_usuario_idx
  on public.apontamentos (empresa_id, user_id) where status = 'em_andamento' and user_id is not null;

-- Mantém os roteiros atuais funcionando: toda operação já associada a uma
-- máquina passa automaticamente a estar vinculada ao respectivo posto.
insert into public.operacao_postos_trabalho (empresa_id, operacao_id, maquina_id)
select o.empresa_id, o.id, o.maquina_id
from public.operacoes o
join public.maquinas m on m.id = o.maquina_id and m.empresa_id = o.empresa_id
where o.maquina_id is not null
on conflict (empresa_id, operacao_id, maquina_id) do nothing;

-- Migração segura para a base instalada: usuários de produção já ativos
-- recebem os postos ativos da empresa. A administração pode restringir os
-- vínculos depois, sem interromper o apontamento no dia da publicação.
insert into public.usuario_postos_trabalho (empresa_id, user_id, maquina_id)
select distinct p.empresa_id, p.user_id, m.id
from public.perfis p
join public.user_roles ur on ur.user_id = p.user_id and ur.empresa_id = p.empresa_id
join public.roles r on r.id = ur.role_id
join public.maquinas m on m.empresa_id = p.empresa_id and m.status = 'ativa'
where p.user_id is not null
  and p.status = 'ativo'
  and r.name in ('system_manager', 'production_manager', 'production_user')
on conflict do nothing;

create or replace function private.eh_gestor_producao(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = (select auth.uid())
      and ur.empresa_id = p_empresa_id
      and r.name in ('system_manager', 'production_manager')
  );
$$;

create or replace function private.pode_acessar_posto_trabalho(p_empresa_id uuid, p_maquina_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.usuario_postos_trabalho upt
    where upt.empresa_id = p_empresa_id
      and upt.user_id = (select auth.uid())
      and upt.maquina_id = p_maquina_id
  ) or exists (
    select 1
    from public.equipe_membros em
    join public.equipes e
      on e.id = em.equipe_id and e.empresa_id = em.empresa_id and e.ativo
    join public.equipe_postos_trabalho ept
      on ept.equipe_id = em.equipe_id and ept.empresa_id = em.empresa_id
    where em.empresa_id = p_empresa_id
      and em.user_id = (select auth.uid())
      and ept.maquina_id = p_maquina_id
  ) or (select private.eh_gestor_producao(p_empresa_id));
$$;

revoke all on function private.eh_gestor_producao(uuid) from public, anon, authenticated;
revoke all on function private.pode_acessar_posto_trabalho(uuid, uuid) from public, anon, authenticated;
grant execute on function private.eh_gestor_producao(uuid), private.pode_acessar_posto_trabalho(uuid, uuid) to authenticated, service_role;

alter table public.usuario_postos_trabalho enable row level security;
alter table public.operacao_postos_trabalho enable row level security;
alter table public.equipes enable row level security;
alter table public.equipe_membros enable row level security;
alter table public.equipe_postos_trabalho enable row level security;
grant select, insert, delete on public.usuario_postos_trabalho to authenticated;
grant select on public.operacao_postos_trabalho to authenticated;
grant select on public.equipes, public.equipe_membros, public.equipe_postos_trabalho to authenticated;
grant insert, update, delete on public.equipes, public.equipe_membros, public.equipe_postos_trabalho to authenticated;
grant select, insert, update, delete on public.usuario_postos_trabalho, public.operacao_postos_trabalho, public.equipes, public.equipe_membros, public.equipe_postos_trabalho to service_role;

drop policy if exists "usuario_postos: proprio ou gestor" on public.usuario_postos_trabalho;
create policy "usuario_postos: proprio ou gestor" on public.usuario_postos_trabalho
for select to authenticated
using (user_id = (select auth.uid()) or (select private.eh_gestor_producao(empresa_id)));

drop policy if exists "usuario_postos: gestor administra" on public.usuario_postos_trabalho;
create policy "usuario_postos: gestor administra" on public.usuario_postos_trabalho
for all to authenticated
using ((select private.eh_gestor_producao(empresa_id)))
with check ((select private.eh_gestor_producao(empresa_id)));

drop policy if exists "operacao_postos: acesso ao posto" on public.operacao_postos_trabalho;
create policy "operacao_postos: acesso ao posto" on public.operacao_postos_trabalho
for select to authenticated
using ((select private.pode_acessar_posto_trabalho(empresa_id, maquina_id)));

drop policy if exists "operacao_postos: gestor administra" on public.operacao_postos_trabalho;
create policy "operacao_postos: gestor administra" on public.operacao_postos_trabalho
for all to authenticated
using ((select private.eh_gestor_producao(empresa_id)))
with check ((select private.eh_gestor_producao(empresa_id)));

drop policy if exists "equipes: membro ou gestor visualiza" on public.equipes;
create policy "equipes: membro ou gestor visualiza" on public.equipes
for select to authenticated
using (
  (select private.eh_gestor_producao(empresa_id))
  or exists (select 1 from public.equipe_membros em where em.equipe_id = id and em.user_id = (select auth.uid()))
);

drop policy if exists "equipes: gestor administra" on public.equipes;
create policy "equipes: gestor administra" on public.equipes for all to authenticated
using ((select private.eh_gestor_producao(empresa_id)))
with check ((select private.eh_gestor_producao(empresa_id)));

drop policy if exists "equipe_membros: proprio ou gestor" on public.equipe_membros;
create policy "equipe_membros: proprio ou gestor" on public.equipe_membros for select to authenticated
using (user_id = (select auth.uid()) or (select private.eh_gestor_producao(empresa_id)));

drop policy if exists "equipe_membros: gestor administra" on public.equipe_membros;
create policy "equipe_membros: gestor administra" on public.equipe_membros for all to authenticated
using ((select private.eh_gestor_producao(empresa_id)))
with check ((select private.eh_gestor_producao(empresa_id)));

drop policy if exists "equipe_postos: membro ou gestor" on public.equipe_postos_trabalho;
create policy "equipe_postos: membro ou gestor" on public.equipe_postos_trabalho for select to authenticated
using (
  (select private.eh_gestor_producao(empresa_id))
  or exists (
    select 1 from public.equipe_membros em
    where em.empresa_id = equipe_postos_trabalho.empresa_id
      and em.equipe_id = equipe_postos_trabalho.equipe_id
      and em.user_id = (select auth.uid())
  )
);

drop policy if exists "equipe_postos: gestor administra" on public.equipe_postos_trabalho;
create policy "equipe_postos: gestor administra" on public.equipe_postos_trabalho for all to authenticated
using ((select private.eh_gestor_producao(empresa_id)))
with check ((select private.eh_gestor_producao(empresa_id)));

create or replace function public.meus_postos_trabalho()
returns table (id uuid, codigo text, nome text, setor text, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct m.id, m.codigo, m.nome, m.setor, m.status
  from public.maquinas m
  join public.perfis p on p.empresa_id = m.empresa_id and p.user_id = (select auth.uid())
  where p.status = 'ativo'
    and m.status = 'ativa'
    and (select private.pode_acessar_posto_trabalho(m.empresa_id, m.id))
  order by m.nome;
$$;

revoke all on function public.meus_postos_trabalho() from public, anon, authenticated;
grant execute on function public.meus_postos_trabalho() to authenticated;

-- A RPC é o único caminho novo de início. Ela não confia nos IDs recebidos do
-- navegador e impede corrida entre duas abas/dispositivos do mesmo usuário.
create or replace function public.iniciar_apontamento_no_posto(
  p_empresa_id uuid,
  p_ordem_id uuid,
  p_operacao_id uuid,
  p_maquina_id uuid
)
returns public.apontamentos
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_operacao public.operacoes%rowtype;
  v_apontamento public.apontamentos%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Sessão expirada' using errcode = '28000';
  end if;

  if not (select private.pode_acessar_posto_trabalho(p_empresa_id, p_maquina_id)) then
    raise exception 'Você não possui acesso a este posto de trabalho' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.maquinas m
    where m.id = p_maquina_id and m.empresa_id = p_empresa_id and m.status = 'ativa'
  ) then
    raise exception 'Posto de trabalho indisponível' using errcode = '23514';
  end if;

  select o.* into v_operacao
  from public.operacoes o
  join public.operacao_postos_trabalho opt
    on opt.operacao_id = o.id and opt.empresa_id = o.empresa_id and opt.ativo
  join public.produtos p
    on p.id = o.produto_id and p.empresa_id = o.empresa_id
  join public.ordens_producao ordem
    on ordem.id = p_ordem_id
   and ordem.empresa_id = o.empresa_id
   and ordem.produto_codigo = p.codigo
   and coalesce(ordem.status, '') <> 'encerrada'
  where o.id = p_operacao_id
    and o.empresa_id = p_empresa_id
    and opt.maquina_id = p_maquina_id;

  if not found then
    raise exception 'A operação não pertence ao posto selecionado' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.ordens_producao op
    where op.id = p_ordem_id and op.empresa_id = p_empresa_id and coalesce(op.status, '') <> 'encerrada'
  ) then
    raise exception 'Ordem de produção indisponível' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.apontamentos a
    where a.empresa_id = p_empresa_id and a.user_id = (select auth.uid()) and a.status = 'em_andamento'
  ) then
    raise exception 'Já existe um apontamento ativo para este usuário' using errcode = '23505';
  end if;

  insert into public.apontamentos (
    empresa_id, user_id, ordem_id, operacao_id, operacao_nome, maquina_id,
    cronometro_inicio, cronometro_total_segundos, pecas_produzidas,
    pecas_refugo, pecas_retrabalho, status, data_apontamento, hora_inicio, hora_fim
  ) values (
    p_empresa_id, (select auth.uid()), p_ordem_id, p_operacao_id, v_operacao.nome, p_maquina_id,
    now(), 0, 0, 0, 0, 'em_andamento', current_date,
    to_char(now(), 'HH24:MI'), to_char(now(), 'HH24:MI')
  ) returning * into v_apontamento;

  update public.ordens_producao set status = 'em_andamento'
  where id = p_ordem_id and empresa_id = p_empresa_id;

  return v_apontamento;
end;
$$;

revoke all on function public.iniciar_apontamento_no_posto(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.iniciar_apontamento_no_posto(uuid, uuid, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
