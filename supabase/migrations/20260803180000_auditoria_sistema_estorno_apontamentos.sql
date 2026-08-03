-- Auditoria do Sistema: consulta protegida e estorno transacional de
-- apontamentos de producao. O lancamento original nunca e removido.

begin;

-- ---------------------------------------------------------------------------
-- Permissoes
-- ---------------------------------------------------------------------------

insert into public.role_permissions (role_id, permission_code)
select r.id, p.permission_code
from public.roles r
cross join (
  values
    ('auditoria.visualizar'),
    ('auditoria.estornar'),
    ('auditoria.exportar'),
    ('auditoria.visualizar_detalhes'),
    ('auditoria.visualizar_valores_sensiveis')
) as p(permission_code)
where r.name = 'system_manager'
on conflict do nothing;

create or replace function private.tem_permissao_auditoria(
  p_empresa_id uuid,
  p_permission_code text,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and exists (
      select 1
      from public.perfis p
      where p.user_id = p_user_id
        and p.empresa_id = p_empresa_id
        and p.status = 'ativo'
    )
    and (
      exists (
        select 1
        from public.user_permissions up
        where up.tenant_id = p_empresa_id
          and up.user_id = p_user_id
          and up.permission_code = p_permission_code
      )
      or exists (
        select 1
        from public.user_roles ur
        join public.role_permissions rp on rp.role_id = ur.role_id
        where ur.empresa_id = p_empresa_id
          and ur.user_id = p_user_id
          and rp.permission_code = p_permission_code
      )
    );
$$;

revoke all on function private.tem_permissao_auditoria(uuid, text, uuid)
  from public, anon, authenticated;

create or replace function public.minhas_permissoes_auditoria(p_empresa_id uuid)
returns table (permission_code text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct permissoes.permission_code
  from (
    select up.permission_code
    from public.user_permissions up
    where up.tenant_id = p_empresa_id
      and up.user_id = auth.uid()

    union all

    select rp.permission_code
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    where ur.empresa_id = p_empresa_id
      and ur.user_id = auth.uid()
  ) permissoes
  where permissoes.permission_code like 'auditoria.%'
    and exists (
      select 1
      from public.perfis p
      where p.user_id = auth.uid()
        and p.empresa_id = p_empresa_id
        and p.status = 'ativo'
    );
$$;

revoke all on function public.minhas_permissoes_auditoria(uuid)
  from public, anon, authenticated;
grant execute on function public.minhas_permissoes_auditoria(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Estrutura imutavel de auditoria e rastreabilidade do estorno
-- ---------------------------------------------------------------------------

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.empresas(id) on delete restrict,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  module text not null,
  original_record_id uuid,
  reversal_record_id uuid,
  performed_by uuid references auth.users(id) on delete set null,
  performed_at timestamptz not null default now(),
  reason_code text,
  reason_description text,
  old_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  affected_records jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  ip_address inet,
  session_id text,
  idempotency_key uuid,
  created_at timestamptz not null default now(),
  constraint audit_logs_reason_required_check check (
    action not in ('reversed', 'deleted_logically', 'reversal_blocked')
    or (reason_code is not null and length(trim(reason_code)) > 0)
  )
);

create index if not exists audit_logs_tenant_date_idx
  on public.audit_logs (tenant_id, performed_at desc, id desc);
create index if not exists audit_logs_entity_idx
  on public.audit_logs (tenant_id, entity_type, entity_id, performed_at desc);
create index if not exists audit_logs_action_idx
  on public.audit_logs (tenant_id, module, action, performed_at desc);
create index if not exists audit_logs_actor_idx
  on public.audit_logs (tenant_id, performed_by, performed_at desc);
create unique index if not exists audit_logs_reversal_idempotency_idx
  on public.audit_logs (tenant_id, idempotency_key)
  where idempotency_key is not null and action = 'reversed';

alter table public.apontamentos
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists status_antes_estorno text,
  add column if not exists estornado_em timestamptz,
  add column if not exists estornado_por uuid references auth.users(id) on delete set null,
  add column if not exists motivo_estorno_codigo text,
  add column if not exists motivo_estorno_descricao text,
  add column if not exists estorno_audit_log_id uuid
    references public.audit_logs(id) on delete restrict deferrable initially deferred;

alter table public.movimentacoes_estoque
  add column if not exists reverses_movement_id uuid
    references public.movimentacoes_estoque(id) on delete restrict,
  add column if not exists reversal_apontamento_id uuid
    references public.apontamentos(id) on delete restrict,
  add column if not exists reversal_audit_log_id uuid
    references public.audit_logs(id) on delete restrict deferrable initially deferred,
  add column if not exists reversal_reason_code text;

create unique index if not exists movimentacoes_estoque_reversal_unique_idx
  on public.movimentacoes_estoque (reverses_movement_id)
  where reverses_movement_id is not null;
create index if not exists movimentacoes_estoque_reversal_apontamento_idx
  on public.movimentacoes_estoque (empresa_id, reversal_apontamento_id, created_at desc)
  where reversal_apontamento_id is not null;
create index if not exists apontamentos_auditoria_data_idx
  on public.apontamentos (empresa_id, created_at desc, id desc)
  include (status, user_id, ordem_id, operacao_id, maquina_id);
create index if not exists apontamentos_estornados_idx
  on public.apontamentos (empresa_id, estornado_em desc)
  where estornado_em is not null;

create or replace function private.bloquear_mutacao_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'O historico de auditoria e imutavel'
    using errcode = '42501';
end;
$$;

drop trigger if exists audit_logs_immutable on public.audit_logs;
create trigger audit_logs_immutable
before update or delete on public.audit_logs
for each row execute function private.bloquear_mutacao_audit_log();

create or replace function private.proteger_estorno_apontamento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contexto text := current_setting('app.audit_reversal_user', true);
begin
  if old.status <> 'em_andamento'
     and coalesce(v_contexto, '') <> coalesce(auth.uid()::text, '')
     and (
       old.pecas_produzidas is distinct from new.pecas_produzidas
       or old.pecas_refugo is distinct from new.pecas_refugo
       or old.pecas_retrabalho is distinct from new.pecas_retrabalho
       or old.cronometro_total_segundos is distinct from new.cronometro_total_segundos
       or old.ordem_id is distinct from new.ordem_id
       or old.operacao_id is distinct from new.operacao_id
       or old.maquina_id is distinct from new.maquina_id
       or old.status is distinct from new.status
     ) then
    raise exception 'Lancamentos finalizados sao imutaveis; use estorno e crie um novo lancamento'
      using errcode = '42501';
  end if;

  if (
    old.estornado_em is distinct from new.estornado_em
    or old.estornado_por is distinct from new.estornado_por
    or old.motivo_estorno_codigo is distinct from new.motivo_estorno_codigo
    or old.motivo_estorno_descricao is distinct from new.motivo_estorno_descricao
    or old.estorno_audit_log_id is distinct from new.estorno_audit_log_id
    or (
      old.status not in ('cancelado', 'cancelada')
      and new.status in ('cancelado', 'cancelada')
    )
  ) and coalesce(v_contexto, '') <> coalesce(auth.uid()::text, '') then
    raise exception 'Use a funcao transacional de auditoria para estornar o apontamento'
      using errcode = '42501';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists apontamentos_proteger_estorno on public.apontamentos;
create trigger apontamentos_proteger_estorno
before update on public.apontamentos
for each row execute function private.proteger_estorno_apontamento();

create or replace function private.bloquear_delete_apontamento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Apontamentos nao podem ser excluidos fisicamente; use o estorno auditavel'
    using errcode = '42501';
end;
$$;

drop trigger if exists apontamentos_bloquear_delete on public.apontamentos;
create trigger apontamentos_bloquear_delete
before delete on public.apontamentos
for each row execute function private.bloquear_delete_apontamento();

create or replace function private.proteger_movimento_estoque_auditavel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.origem in ('producao', 'auditoria')
     or old.reverses_movement_id is not null
     or old.reversal_apontamento_id is not null then
    raise exception 'Movimentacoes de producao e estorno sao imutaveis; crie uma nova movimentacao compensatoria'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists movimentacoes_estoque_auditaveis_immutable
  on public.movimentacoes_estoque;
create trigger movimentacoes_estoque_auditaveis_immutable
before update or delete on public.movimentacoes_estoque
for each row execute function private.proteger_movimento_estoque_auditavel();

alter table public.audit_logs enable row level security;

revoke all on public.audit_logs from public, anon, authenticated;
grant select on public.audit_logs to authenticated;
grant select, insert on public.audit_logs to service_role;

drop policy if exists "auditoria: autorizado visualiza" on public.audit_logs;
create policy "auditoria: autorizado visualiza" on public.audit_logs
for select to authenticated
using (private.tem_permissao_auditoria(tenant_id, 'auditoria.visualizar'));

-- ---------------------------------------------------------------------------
-- Listagem paginada. A funcao retorna somente apontamentos do tenant da sessao.
-- Outros modulos poderao ganhar funcoes/estrategias proprias e entrar nesta
-- listagem sem transformar o estorno em um DELETE generico.
-- ---------------------------------------------------------------------------

create or replace function public.listar_auditoria_sistema(
  p_empresa_id uuid,
  p_page integer default 1,
  p_page_size integer default 25,
  p_periodo_inicio timestamptz default null,
  p_periodo_fim timestamptz default null,
  p_usuario text default null,
  p_operador text default null,
  p_modulo text default null,
  p_tipo text default null,
  p_status text default null,
  p_ordem_producao text default null,
  p_produto_codigo text default null,
  p_produto_descricao text default null,
  p_operacao text default null,
  p_maquina text default null,
  p_posto_trabalho text default null,
  p_search text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 25), 1), 500);
  v_result jsonb;
begin
  if not private.tem_permissao_auditoria(
    p_empresa_id,
    'auditoria.visualizar'
  ) then
    raise exception 'Acesso negado a auditoria ou tenant invalido'
      using errcode = '42501';
  end if;

  with base as (
    select
      a.id,
      a.empresa_id as tenant_id,
      e.nome as tenant_nome,
      coalesce(a.finalizado_em, a.created_at) as lancamento_em,
      a.updated_at,
      'apontamento_producao'::text as tipo_lancamento,
      'producao'::text as modulo,
      format('Apontamento de producao na operacao %s', coalesce(o.nome, a.operacao_nome, 'nao identificada')) as descricao,
      a.user_id,
      coalesce(p.nome, p.email, a.user_id::text) as usuario_nome,
      coalesce(p.nome, p.email, a.user_id::text) as operador_nome,
      op.id as ordem_id,
      op.numero_op,
      op.produto_codigo,
      pr.descricao as produto_descricao,
      a.operacao_id,
      coalesce(o.nome, a.operacao_nome) as operacao_nome,
      a.maquina_id,
      m.codigo as maquina_codigo,
      m.nome as maquina_nome,
      coalesce(a.pecas_produzidas, 0) as quantidade_lancada,
      greatest(coalesce(a.pecas_produzidas, 0) - coalesce(a.pecas_refugo, 0), 0) as quantidade_aprovada,
      coalesce(a.pecas_refugo, 0) as quantidade_refugada,
      coalesce(a.pecas_retrabalho, 0) as quantidade_retrabalho,
      'un'::text as unidade_medida,
      a.status as status_operacional,
      case
        when a.estornado_em is not null then 'estornado'
        when a.status in ('cancelado', 'cancelada') then 'cancelado'
        else 'ativo'
      end as status_atual,
      case when a.user_id = a.finalizado_por then 'operador' else 'sistema' end as origem,
      a.estornado_em,
      a.estornado_por,
      coalesce(pe.nome, pe.email) as estornado_por_nome,
      a.motivo_estorno_codigo,
      a.motivo_estorno_descricao,
      a.estorno_audit_log_id,
      (a.finalizado_em is null and coalesce(a.pecas_produzidas, 0) > 0) as dados_legados
    from public.apontamentos a
    join public.empresas e on e.id = a.empresa_id
    left join public.perfis p
      on p.user_id = a.user_id and p.empresa_id = a.empresa_id
    left join public.perfis pe
      on pe.user_id = a.estornado_por and pe.empresa_id = a.empresa_id
    left join public.ordens_producao op
      on op.id = a.ordem_id and op.empresa_id = a.empresa_id
    left join public.produtos pr
      on pr.empresa_id = a.empresa_id and pr.codigo = op.produto_codigo
    left join public.operacoes o
      on o.id = a.operacao_id and o.empresa_id = a.empresa_id
    left join public.maquinas m
      on m.id = a.maquina_id and m.empresa_id = a.empresa_id
    where a.empresa_id = p_empresa_id
  ), filtrados as (
    select *
    from base b
    where (p_periodo_inicio is null or b.lancamento_em >= p_periodo_inicio)
      and (p_periodo_fim is null or b.lancamento_em <= p_periodo_fim)
      and (nullif(trim(p_usuario), '') is null or lower(b.usuario_nome) like '%' || lower(trim(p_usuario)) || '%')
      and (nullif(trim(p_operador), '') is null or lower(b.operador_nome) like '%' || lower(trim(p_operador)) || '%')
      and (nullif(trim(p_modulo), '') is null or lower(b.modulo) = lower(trim(p_modulo)))
      and (nullif(trim(p_tipo), '') is null or lower(b.tipo_lancamento) = lower(trim(p_tipo)))
      and (nullif(trim(p_status), '') is null or lower(b.status_atual) = lower(trim(p_status)))
      and (nullif(trim(p_ordem_producao), '') is null or lower(coalesce(b.numero_op, '')) like '%' || lower(trim(p_ordem_producao)) || '%')
      and (nullif(trim(p_produto_codigo), '') is null or lower(coalesce(b.produto_codigo, '')) like '%' || lower(trim(p_produto_codigo)) || '%')
      and (nullif(trim(p_produto_descricao), '') is null or lower(coalesce(b.produto_descricao, '')) like '%' || lower(trim(p_produto_descricao)) || '%')
      and (nullif(trim(p_operacao), '') is null or lower(coalesce(b.operacao_nome, '')) like '%' || lower(trim(p_operacao)) || '%')
      and (
        nullif(trim(p_maquina), '') is null
        or lower(concat_ws(' ', b.maquina_codigo, b.maquina_nome)) like '%' || lower(trim(p_maquina)) || '%'
      )
      and (
        nullif(trim(p_posto_trabalho), '') is null
        or lower(concat_ws(' ', b.maquina_codigo, b.maquina_nome)) like '%' || lower(trim(p_posto_trabalho)) || '%'
      )
      and (
        nullif(trim(p_search), '') is null
        or lower(coalesce(b.numero_op, '')) like '%' || lower(trim(p_search)) || '%'
        or lower(coalesce(b.produto_codigo, '')) like '%' || lower(trim(p_search)) || '%'
        or lower(coalesce(b.produto_descricao, '')) like '%' || lower(trim(p_search)) || '%'
        or lower(coalesce(b.usuario_nome, '')) like '%' || lower(trim(p_search)) || '%'
        or lower(coalesce(b.operador_nome, '')) like '%' || lower(trim(p_search)) || '%'
        or lower(b.id::text) like '%' || lower(trim(p_search)) || '%'
        or lower(coalesce(b.motivo_estorno_codigo, '')) like '%' || lower(trim(p_search)) || '%'
        or lower(coalesce(b.motivo_estorno_descricao, '')) like '%' || lower(trim(p_search)) || '%'
      )
  ), pagina as (
    select *
    from filtrados
    order by lancamento_em desc, id desc
    offset (v_page - 1) * v_page_size
    limit v_page_size
  )
  select jsonb_build_object(
    'items', coalesce(
      (select jsonb_agg(to_jsonb(p) order by p.lancamento_em desc, p.id desc) from pagina p),
      '[]'::jsonb
    ),
    'pagination', jsonb_build_object(
      'page', v_page,
      'page_size', v_page_size,
      'total', (select count(*) from filtrados),
      'total_pages', ceiling((select count(*) from filtrados)::numeric / v_page_size)::integer
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.listar_auditoria_sistema(
  uuid, integer, integer, timestamptz, timestamptz, text, text, text, text,
  text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.listar_auditoria_sistema(
  uuid, integer, integer, timestamptz, timestamptz, text, text, text, text,
  text, text, text, text, text, text, text, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- Detalhes sob demanda, relacionamentos, historico e bloqueios conhecidos
-- ---------------------------------------------------------------------------

create or replace function public.obter_detalhes_auditoria(
  p_empresa_id uuid,
  p_lancamento_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
begin
  if not private.tem_permissao_auditoria(
    p_empresa_id,
    'auditoria.visualizar_detalhes'
  ) then
    raise exception 'Acesso negado aos detalhes da auditoria ou tenant invalido'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'geral', jsonb_build_object(
      'id', a.id,
      'tenant_id', a.empresa_id,
      'tenant_nome', e.nome,
      'modulo', 'producao',
      'tipo', 'apontamento_producao',
      'usuario_id', a.user_id,
      'usuario_nome', coalesce(p.nome, p.email, a.user_id::text),
      'operador_nome', coalesce(p.nome, p.email, a.user_id::text),
      'data_hora', coalesce(a.finalizado_em, a.created_at),
      'origem', case when a.user_id = a.finalizado_por then 'operador' else 'sistema' end,
      'status_operacional', a.status,
      'status_atual', case when a.estornado_em is not null then 'estornado' when a.status in ('cancelado', 'cancelada') then 'cancelado' else 'ativo' end,
      'ultima_alteracao', a.updated_at,
      'estornado_em', a.estornado_em,
      'estornado_por', coalesce(pe.nome, pe.email),
      'motivo_codigo', a.motivo_estorno_codigo,
      'motivo_descricao', a.motivo_estorno_descricao
    ),
    'valores', jsonb_build_object(
      'quantidade_lancada', coalesce(a.pecas_produzidas, 0),
      'quantidade_aprovada', greatest(coalesce(a.pecas_produzidas, 0) - coalesce(a.pecas_refugo, 0), 0),
      'quantidade_refugada', coalesce(a.pecas_refugo, 0),
      'quantidade_retrabalho', coalesce(a.pecas_retrabalho, 0),
      'tempo_produtivo_segundos', coalesce(a.cronometro_total_segundos, 0),
      'situacao_antes', a.status_antes_estorno,
      'situacao_depois', a.status
    ),
    'relacionamentos', jsonb_build_object(
      'ordem_producao', case when op.id is null then null else jsonb_build_object('id', op.id, 'numero', op.numero_op, 'status', op.status, 'quantidade_planejada', op.quantidade, 'quantidade_produzida', op.quantidade_produzida, 'quantidade_aprovada', op.quantidade_aprovada) end,
      'operacao', case when o.id is null then null else jsonb_build_object('id', o.id, 'nome', o.nome, 'sequencia', o.ordem) end,
      'produto', case when pr.id is null then null else jsonb_build_object('id', pr.id, 'codigo', pr.codigo, 'descricao', pr.descricao) end,
      'maquina', case when m.id is null then null else jsonb_build_object('id', m.id, 'codigo', m.codigo, 'nome', m.nome) end,
      'movimentacoes_estoque', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', me.id,
          'tipo', me.tipo,
          'quantidade', me.quantidade,
          'quantidade_anterior', me.quantidade_anterior,
          'quantidade_posterior', me.quantidade_posterior,
          'origem', me.origem,
          'insumo_codigo', i.codigo,
          'insumo_descricao', i.descricao,
          'reverses_movement_id', me.reverses_movement_id,
          'created_at', me.created_at
        ) order by me.created_at, me.id)
        from public.movimentacoes_estoque me
        left join public.insumos i
          on i.id = me.insumo_id and i.empresa_id = me.empresa_id
        where me.empresa_id = a.empresa_id
          and (
            (me.origem = 'producao' and me.referencia_id = a.id)
            or me.reversal_apontamento_id = a.id
          )
      ), '[]'::jsonb)
    ),
    'historico', coalesce((
      select jsonb_agg(h.evento order by h.ocorreu_em, h.ordem)
      from (
        select
          a.created_at as ocorreu_em,
          0 as ordem,
          jsonb_build_object(
            'action', 'created',
            'occurred_at', a.created_at,
            'performed_by', coalesce(p.nome, p.email),
            'reason', null,
            'metadata', jsonb_build_object('status', a.status_antes_estorno, 'origem', 'apontamento')
          ) as evento

        union all

        select
          poe.started_at,
          1,
          jsonb_build_object(
            'action', poe.event_type,
            'occurred_at', poe.started_at,
            'performed_by', coalesce(pp.nome, pp.email),
            'reason', poe.resume_justification,
            'metadata', poe.metadata
          )
        from public.production_order_events poe
        left join public.perfis pp
          on pp.user_id = poe.created_by and pp.empresa_id = poe.tenant_id
        where poe.tenant_id = a.empresa_id
          and poe.apontamento_id = a.id

        union all

        select
          al.performed_at,
          2,
          jsonb_build_object(
            'action', al.action,
            'occurred_at', al.performed_at,
            'performed_by', coalesce(pa.nome, pa.email),
            'reason', coalesce(al.reason_description, al.reason_code),
            'metadata', al.metadata
          )
        from public.audit_logs al
        left join public.perfis pa
          on pa.user_id = al.performed_by and pa.empresa_id = al.tenant_id
        where al.tenant_id = a.empresa_id
          and al.entity_type = 'apontamento_producao'
          and al.entity_id = a.id
      ) h
    ), '[]'::jsonb),
    'dependencias', jsonb_build_object(
      'dados_legados', (
        a.finalizado_em is null
        and coalesce(a.pecas_produzidas, 0) > 0
        and not exists (
          select 1 from public.movimentacoes_estoque ml
          where ml.empresa_id = a.empresa_id
            and ml.referencia_id = a.id
            and ml.origem = 'producao'
        )
      ),
      'vinculos_ausentes', to_jsonb(array_remove(array[
        case when op.id is null then 'ordem_producao' end,
        case when o.id is null then 'operacao' end,
        case when pr.id is null then 'produto' end
      ], null)),
      'bloqueios_estoque', coalesce((
        select jsonb_agg(jsonb_build_object(
          'movimentacao_id', mo.id,
          'insumo_codigo', io.codigo,
          'quantidade_necessaria', mo.quantidade,
          'saldo_disponivel', coalesce(se.saldo_atual, 0),
          'motivo', 'saldo_insuficiente_para_movimentacao_inversa'
        ))
        from public.movimentacoes_estoque mo
        join public.insumos io
          on io.id = mo.insumo_id and io.empresa_id = mo.empresa_id
        left join public.saldo_estoque se
          on se.empresa_id = mo.empresa_id and se.insumo_id = mo.insumo_id
        where mo.empresa_id = a.empresa_id
          and mo.referencia_id = a.id
          and mo.origem = 'producao'
          and mo.tipo in ('entrada', 'entrada_producao')
          and not exists (
            select 1 from public.movimentacoes_estoque r
            where r.reverses_movement_id = mo.id
          )
          and coalesce(se.saldo_atual, 0) < mo.quantidade
      ), '[]'::jsonb)
    )
  ) into v_result
  from public.apontamentos a
  join public.empresas e on e.id = a.empresa_id
  left join public.perfis p
    on p.user_id = a.user_id and p.empresa_id = a.empresa_id
  left join public.perfis pe
    on pe.user_id = a.estornado_por and pe.empresa_id = a.empresa_id
  left join public.ordens_producao op
    on op.id = a.ordem_id and op.empresa_id = a.empresa_id
  left join public.produtos pr
    on pr.empresa_id = a.empresa_id and pr.codigo = op.produto_codigo
  left join public.operacoes o
    on o.id = a.operacao_id and o.empresa_id = a.empresa_id
  left join public.maquinas m
    on m.id = a.maquina_id and m.empresa_id = a.empresa_id
  where a.id = p_lancamento_id
    and a.empresa_id = p_empresa_id;

  if v_result is null then
    raise exception 'Lancamento nao encontrado neste tenant'
      using errcode = 'P0002';
  end if;

  return v_result;
end;
$$;

revoke all on function public.obter_detalhes_auditoria(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.obter_detalhes_auditoria(uuid, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Estorno. A funcao usa lock de linha, unique key por movimento e chave de
-- idempotencia. Qualquer excecao desfaz saldos, movimentos, OP e apontamento.
-- ---------------------------------------------------------------------------

create or replace function public.estornar_apontamento_auditoria(
  p_empresa_id uuid,
  p_apontamento_id uuid,
  p_motivo_codigo text,
  p_motivo_descricao text default null,
  p_idempotency_key uuid default gen_random_uuid(),
  p_ip_address inet default null,
  p_session_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_apontamento public.apontamentos%rowtype;
  v_ordem public.ordens_producao%rowtype;
  v_movimento record;
  v_saldo public.saldo_estoque%rowtype;
  v_audit_id uuid := gen_random_uuid();
  v_reversal_id uuid;
  v_saldo_posterior numeric;
  v_tipo_inverso text;
  v_movimentos jsonb := '[]'::jsonb;
  v_dependencias jsonb := '[]'::jsonb;
  v_estado_op jsonb;
  v_status_operacao text;
  v_quantidade_creditada_revertida integer := 0;
  v_log_existente uuid;
begin
  if not private.tem_permissao_auditoria(
    p_empresa_id,
    'auditoria.estornar',
    v_user_id
  ) then
    raise exception 'Acesso negado ao estorno ou tenant invalido'
      using errcode = '42501';
  end if;

  if nullif(trim(p_motivo_codigo), '') is null then
    raise exception 'O motivo do estorno e obrigatorio'
      using errcode = '22023';
  end if;

  if p_motivo_codigo = 'outro'
     and nullif(trim(coalesce(p_motivo_descricao, '')), '') is null then
    raise exception 'Descreva o motivo quando a opcao Outro for selecionada'
      using errcode = '22023';
  end if;

  select al.id into v_log_existente
  from public.audit_logs al
  where al.tenant_id = p_empresa_id
    and al.idempotency_key = p_idempotency_key
    and al.action = 'reversed';

  if v_log_existente is not null then
    return jsonb_build_object(
      'success', true,
      'idempotente', true,
      'lancamento_id', p_apontamento_id,
      'audit_log_id', v_log_existente,
      'message', 'Esta solicitacao de estorno ja foi processada.'
    );
  end if;

  select a.* into v_apontamento
  from public.apontamentos a
  where a.id = p_apontamento_id
    and a.empresa_id = p_empresa_id
  for update;

  if not found then
    raise exception 'Lancamento nao encontrado neste tenant'
      using errcode = 'P0002';
  end if;

  if v_apontamento.estornado_em is not null then
    return jsonb_build_object(
      'success', false,
      'code', 'already_reversed',
      'lancamento_id', v_apontamento.id,
      'audit_log_id', v_apontamento.estorno_audit_log_id,
      'message', 'Este lancamento ja foi estornado anteriormente e nao pode ser processado novamente.'
    );
  end if;

  if v_apontamento.status = 'em_andamento' then
    return jsonb_build_object(
      'success', false,
      'code', 'active_entry',
      'message', 'Finalize o apontamento em andamento antes de solicitar o estorno.'
    );
  end if;

  select op.* into v_ordem
  from public.ordens_producao op
  where op.id = v_apontamento.ordem_id
    and op.empresa_id = p_empresa_id
  for update;

  if not found or not exists (
    select 1 from public.operacoes o
    where o.id = v_apontamento.operacao_id
      and o.empresa_id = p_empresa_id
  ) then
    return jsonb_build_object(
      'success', false,
      'code', 'legacy_traceability',
      'message', 'O lancamento possui vinculos legados insuficientes para um estorno seguro.',
      'missing_links', jsonb_build_array('ordem_producao_ou_operacao')
    );
  end if;

  if v_apontamento.finalizado_em is null
     and coalesce(v_apontamento.pecas_produzidas, 0) > 0
     and not exists (
       select 1
       from public.movimentacoes_estoque me
       where me.empresa_id = p_empresa_id
         and me.referencia_id = v_apontamento.id
         and me.origem = 'producao'
     ) then
    return jsonb_build_object(
      'success', false,
      'code', 'legacy_traceability',
      'message', 'O lancamento e anterior ao fluxo transacional e nao possui rastreabilidade de estoque suficiente.',
      'missing_links', jsonb_build_array('movimentacoes_estoque')
    );
  end if;

  if exists (
    select 1
    from public.movimentacoes_estoque original
    join public.movimentacoes_estoque inversa
      on inversa.reverses_movement_id = original.id
    where original.empresa_id = p_empresa_id
      and original.referencia_id = v_apontamento.id
      and original.origem = 'producao'
  ) then
    raise exception 'Foram encontradas movimentacoes inversas sem o apontamento marcado como estornado'
      using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'movimentacao_id', original.id,
    'insumo_codigo', ins.codigo,
    'quantidade_necessaria', original.quantidade,
    'saldo_disponivel', coalesce(saldo.saldo_atual, 0),
    'motivo', 'saldo_insuficiente_para_movimentacao_inversa'
  )), '[]'::jsonb)
  into v_dependencias
  from public.movimentacoes_estoque original
  join public.insumos ins
    on ins.id = original.insumo_id and ins.empresa_id = original.empresa_id
  left join public.saldo_estoque saldo
    on saldo.empresa_id = original.empresa_id
   and saldo.insumo_id = original.insumo_id
  where original.empresa_id = p_empresa_id
    and original.referencia_id = v_apontamento.id
    and original.origem = 'producao'
    and original.tipo in ('entrada', 'entrada_producao')
    and coalesce(saldo.saldo_atual, 0) < original.quantidade;

  if jsonb_array_length(v_dependencias) > 0 then
    insert into public.audit_logs (
      tenant_id, entity_type, entity_id, action, module,
      original_record_id, performed_by, reason_code, reason_description,
      affected_records, metadata, ip_address, session_id
    ) values (
      p_empresa_id, 'apontamento_producao', v_apontamento.id,
      'reversal_blocked', 'producao', v_apontamento.id, v_user_id,
      p_motivo_codigo, nullif(trim(coalesce(p_motivo_descricao, '')), ''),
      v_dependencias,
      jsonb_build_object('code', 'stock_dependencies'),
      p_ip_address, p_session_id
    );

    return jsonb_build_object(
      'success', false,
      'code', 'stock_dependencies',
      'dependencies', v_dependencias,
      'message', 'Nao foi possivel estornar o lancamento porque existem movimentacoes posteriores dependentes. Consulte os detalhes antes de continuar.'
    );
  end if;

  -- O trigger de protecao aceita a alteracao somente dentro deste fluxo.
  perform set_config('app.audit_reversal_user', v_user_id::text, true);

  for v_movimento in
    select me.*, ins.codigo as insumo_codigo
    from public.movimentacoes_estoque me
    join public.insumos ins
      on ins.id = me.insumo_id and ins.empresa_id = me.empresa_id
    where me.empresa_id = p_empresa_id
      and me.referencia_id = v_apontamento.id
      and me.origem = 'producao'
    order by me.created_at, me.id
    for update of me
  loop
    select s.* into v_saldo
    from public.saldo_estoque s
    where s.empresa_id = p_empresa_id
      and s.insumo_id = v_movimento.insumo_id
    for update;

    if not found then
      raise exception 'Saldo de estoque nao encontrado para o item %', v_movimento.insumo_codigo
        using errcode = '23503';
    end if;

    if v_movimento.tipo in ('entrada', 'entrada_producao') then
      if v_saldo.saldo_atual < v_movimento.quantidade then
        raise exception 'Saldo insuficiente para estornar o item %', v_movimento.insumo_codigo
          using errcode = '23514';
      end if;
      v_saldo_posterior := v_saldo.saldo_atual - v_movimento.quantidade;
      v_tipo_inverso := 'estorno_saida';
      if v_movimento.insumo_codigo = v_ordem.produto_codigo then
        v_quantidade_creditada_revertida := v_quantidade_creditada_revertida
          + v_movimento.quantidade::integer;
      end if;
    elsif v_movimento.tipo in ('saida', 'saida_producao') then
      v_saldo_posterior := v_saldo.saldo_atual + v_movimento.quantidade;
      v_tipo_inverso := 'estorno_entrada';
    else
      raise exception 'Tipo de movimentacao % sem estrategia de estorno', v_movimento.tipo
        using errcode = '0A000';
    end if;

    update public.saldo_estoque
    set saldo_atual = v_saldo_posterior,
        valor_total = v_saldo_posterior * coalesce(v_saldo.custo_medio, 0),
        updated_at = now()
    where empresa_id = p_empresa_id
      and insumo_id = v_movimento.insumo_id;

    v_reversal_id := gen_random_uuid();
    insert into public.movimentacoes_estoque (
      id, empresa_id, insumo_id, tipo, quantidade,
      quantidade_anterior, quantidade_posterior, custo_unitario, valor_total,
      origem, referencia_id, local_id, observacao, created_by,
      reverses_movement_id, reversal_apontamento_id,
      reversal_audit_log_id, reversal_reason_code
    ) values (
      v_reversal_id, p_empresa_id, v_movimento.insumo_id, v_tipo_inverso,
      v_movimento.quantidade, v_saldo.saldo_atual, v_saldo_posterior,
      v_movimento.custo_unitario, v_movimento.valor_total,
      'auditoria', v_apontamento.id, v_movimento.local_id,
      format('Estorno auditavel do apontamento %s: %s', v_apontamento.id, p_motivo_codigo),
      v_user_id, v_movimento.id, v_apontamento.id, v_audit_id,
      p_motivo_codigo
    );

    v_movimentos := v_movimentos || jsonb_build_array(jsonb_build_object(
      'original_movement_id', v_movimento.id,
      'reversal_movement_id', v_reversal_id,
      'insumo_id', v_movimento.insumo_id,
      'tipo_original', v_movimento.tipo,
      'tipo_estorno', v_tipo_inverso,
      'quantidade', v_movimento.quantidade,
      'saldo_anterior', v_saldo.saldo_atual,
      'saldo_posterior', v_saldo_posterior
    ));
  end loop;

  update public.ordens_producao
  set quantidade_aprovada_estoque = greatest(
    coalesce(quantidade_aprovada_estoque, 0) - v_quantidade_creditada_revertida,
    0
  )
  where id = v_ordem.id
    and empresa_id = p_empresa_id;

  update public.apontamentos
  set status_antes_estorno = v_apontamento.status,
      status = 'cancelado',
      estado_operacao = 'finalizada',
      estornado_em = now(),
      estornado_por = v_user_id,
      motivo_estorno_codigo = trim(p_motivo_codigo),
      motivo_estorno_descricao = nullif(trim(coalesce(p_motivo_descricao, '')), ''),
      estorno_audit_log_id = v_audit_id,
      updated_at = now()
  where id = v_apontamento.id
    and empresa_id = p_empresa_id;

  -- O trigger de apontamentos tambem recalcula; a chamada explicita fornece o
  -- estado final para a resposta e torna a intencao do fluxo inequívoca.
  v_estado_op := private.recalcular_ordem_producao(
    p_empresa_id,
    v_apontamento.ordem_id
  );

  select oor.status_operacao into v_status_operacao
  from public.ordem_operacoes_resumo oor
  where oor.empresa_id = p_empresa_id
    and oor.ordem_id = v_apontamento.ordem_id
    and oor.operacao_id = v_apontamento.operacao_id;

  insert into public.audit_logs (
    id, tenant_id, entity_type, entity_id, action, module,
    original_record_id, performed_by, reason_code, reason_description,
    old_values, new_values, affected_records, metadata,
    ip_address, session_id, idempotency_key
  ) values (
    v_audit_id, p_empresa_id, 'apontamento_producao', v_apontamento.id,
    'reversed', 'producao', v_apontamento.id, v_user_id,
    trim(p_motivo_codigo), nullif(trim(coalesce(p_motivo_descricao, '')), ''),
    to_jsonb(v_apontamento),
    jsonb_build_object(
      'status', 'cancelado',
      'status_auditoria', 'estornado',
      'estornado_em', now(),
      'estornado_por', v_user_id
    ),
    jsonb_build_object(
      'movimentacoes_estoque', v_movimentos,
      'ordem_producao_id', v_apontamento.ordem_id,
      'operacao_id', v_apontamento.operacao_id,
      'maquina_id', v_apontamento.maquina_id
    ),
    jsonb_build_object(
      'estoque_recalculado', true,
      'oee_recalculado', true,
      'produtividade_recalculada', true,
      'relatorios_atualizados', true,
      'custos_recalculados', true,
      'quantidade_creditada_estoque_revertida', v_quantidade_creditada_revertida,
      'op_status_anterior', v_ordem.status,
      'op_status_atual', v_estado_op ->> 'op_status',
      'operacao_status_atual', v_status_operacao
    ),
    p_ip_address, p_session_id, p_idempotency_key
  );

  insert into public.production_order_events (
    tenant_id, production_order_id, operation_id, workstation_id,
    machine_id, operator_id, apontamento_id, event_type, event_category,
    source, started_at, ended_at, duration_seconds, created_by, metadata
  ) values (
    p_empresa_id, v_apontamento.ordem_id, v_apontamento.operacao_id,
    v_apontamento.maquina_id, v_apontamento.maquina_id,
    v_apontamento.user_id, v_apontamento.id,
    'production_report_reversed', 'audit', 'administrator',
    now(), now(), 0, v_user_id,
    jsonb_build_object(
      'audit_log_id', v_audit_id,
      'motivo_codigo', p_motivo_codigo,
      'status_apontamento_anterior', v_apontamento.status,
      'status_apontamento_atual', 'cancelado',
      'status_operacao_atual', v_status_operacao,
      'status_op_anterior', v_ordem.status,
      'status_op_atual', v_estado_op ->> 'op_status'
    )
  );

  return jsonb_build_object(
    'success', true,
    'idempotente', false,
    'lancamento_id', v_apontamento.id,
    'status_anterior', v_apontamento.status,
    'status_atual', 'estornado',
    'estoque_recalculado', true,
    'oee_recalculado', true,
    'operacao_recalculada', true,
    'op_recalculada', true,
    'relatorios_atualizados', true,
    'custos_recalculados', true,
    'operacao_status', v_status_operacao,
    'op_status', v_estado_op ->> 'op_status',
    'quantidade_consolidada_op', (v_estado_op ->> 'quantidade_consolidada_op')::integer,
    'audit_log_id', v_audit_id,
    'movimentacoes_inversas', jsonb_array_length(v_movimentos),
    'message', 'Lancamento estornado com sucesso. Estoques, OEE, operacao, Ordem de Producao e relatorios relacionados foram recalculados.'
  );
exception
  when unique_violation then
    select al.id into v_log_existente
    from public.audit_logs al
    where al.tenant_id = p_empresa_id
      and al.idempotency_key = p_idempotency_key
      and al.action = 'reversed';

    if v_log_existente is not null then
      return jsonb_build_object(
        'success', true,
        'idempotente', true,
        'lancamento_id', p_apontamento_id,
        'audit_log_id', v_log_existente,
        'message', 'Esta solicitacao de estorno ja foi processada.'
      );
    end if;
    raise;
end;
$$;

revoke all on function public.estornar_apontamento_auditoria(
  uuid, uuid, text, text, uuid, inet, text
) from public, anon, authenticated;
grant execute on function public.estornar_apontamento_auditoria(
  uuid, uuid, text, text, uuid, inet, text
) to authenticated;

comment on function public.estornar_apontamento_auditoria(
  uuid, uuid, text, text, uuid, inet, text
) is 'Estorna um apontamento de producao com lock, idempotencia, movimentos inversos, recalculo da OP e historico imutavel na mesma transacao.';

notify pgrst, 'reload schema';

commit;

-- Rollback documentado:
-- 1. remover as grants/RPCs desta migration;
-- 2. remover os triggers apontamentos_proteger_estorno e audit_logs_immutable;
-- 3. manter audit_logs e colunas de estorno para preservar o historico ja criado;
-- 4. nao excluir movimentacoes inversas: qualquer compensacao deve ser um novo
--    lancamento auditavel.
