-- Corrige o encerramento prematuro de OPs e centraliza a finalização do
-- apontamento. A quantidade consolidada usa o menor avanço entre todas as
-- operações obrigatórias ativas. Assim, as mesmas peças não são somadas uma
-- vez por etapa e operações paralelas podem terminar em qualquer ordem.

begin;

alter table public.operacoes
  add column if not exists obrigatoria boolean not null default true;

alter table public.ordens_producao
  add column if not exists quantidade_produzida integer not null default 0,
  add column if not exists quantidade_aprovada integer not null default 0,
  add column if not exists quantidade_aprovada_estoque integer not null default 0,
  add column if not exists concluida_em timestamptz;

alter table public.apontamentos
  add column if not exists finalizado_em timestamptz,
  add column if not exists finalizado_por uuid references auth.users(id) on delete set null;

create index if not exists operacoes_roteiro_obrigatorio_idx
  on public.operacoes (empresa_id, produto_id, ordem)
  where ativo and obrigatoria;

create index if not exists apontamentos_fluxo_op_idx
  on public.apontamentos (empresa_id, ordem_id, operacao_id, status)
  include (pecas_produzidas, pecas_refugo, pecas_retrabalho);

create unique index if not exists production_order_events_finalizacao_unique_idx
  on public.production_order_events (tenant_id, apontamento_id, event_type)
  where event_type = 'production_report_finalized';

-- Estado por operação/OP sem gravar status na tabela de roteiro compartilhada.
-- A view respeita as políticas das tabelas-base (security_invoker).
create or replace view public.ordem_operacoes_resumo
with (security_invoker = true)
as
select
  op.empresa_id,
  op.id as ordem_id,
  o.id as operacao_id,
  o.ordem as sequencia,
  o.nome as operacao_nome,
  coalesce(o.ativo, true) as ativa,
  coalesce(o.obrigatoria, true) as obrigatoria,
  op.quantidade as quantidade_planejada,
  coalesce(sum(a.pecas_produzidas) filter (
    where a.status not in ('cancelado', 'cancelada')
  ), 0)::integer as quantidade_processada,
  coalesce(sum(greatest(
    coalesce(a.pecas_produzidas, 0) - coalesce(a.pecas_refugo, 0),
    0
  )) filter (
    where a.status not in ('cancelado', 'cancelada')
  ), 0)::integer as quantidade_aprovada,
  case
    when not coalesce(o.ativo, true) then 'desativada'
    when not coalesce(o.obrigatoria, true) then 'opcional'
    when coalesce(bool_or(a.status = 'em_andamento'), false) then 'em_andamento'
    when coalesce(sum(a.pecas_produzidas) filter (
      where a.status not in ('cancelado', 'cancelada')
    ), 0) >= op.quantidade then 'concluida'
    when coalesce(sum(a.pecas_produzidas) filter (
      where a.status not in ('cancelado', 'cancelada')
    ), 0) > 0 then 'parcialmente_concluida'
    else 'pendente'
  end as status_operacao
from public.ordens_producao op
join public.produtos p
  on p.empresa_id = op.empresa_id
 and p.codigo = op.produto_codigo
join public.operacoes o
  on o.empresa_id = op.empresa_id
 and o.produto_id = p.id
left join public.apontamentos a
  on a.empresa_id = op.empresa_id
 and a.ordem_id = op.id
 and a.operacao_id = o.id
group by
  op.empresa_id,
  op.id,
  o.id,
  o.ordem,
  o.nome,
  o.ativo,
  o.obrigatoria,
  op.quantidade;

revoke all on public.ordem_operacoes_resumo from public, anon;
grant select on public.ordem_operacoes_resumo to authenticated;

-- O trigger antigo olhava somente a operação de maior sequência. Isso encerrava
-- a OP mesmo com operações anteriores ou paralelas ainda pendentes.
drop trigger if exists apontamentos_encerrar_op_ao_atingir_planejado
  on public.apontamentos;
drop function if exists public.encerrar_op_ao_atingir_planejado();

-- A versão anterior ainda contabilizava a quantidade de um apontamento quando
-- ele era cancelado e fazia a soma sob RLS. O trigger precisa enxergar todos os
-- operadores da OP para proteger corretamente finalizações concorrentes.
create or replace function public.validar_quantidade_planejada_apontamento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quantidade_planejada integer;
  v_total_outros integer;
  v_quantidade_restante integer;
begin
  if new.empresa_id is null or new.operacao_id is null then
    return new;
  end if;

  if coalesce(new.pecas_produzidas, 0) < 0
     or coalesce(new.pecas_refugo, 0) < 0
     or coalesce(new.pecas_retrabalho, 0) < 0 then
    raise exception 'As quantidades do apontamento não podem ser negativas'
      using errcode = '22023';
  end if;

  if coalesce(new.pecas_refugo, 0) > coalesce(new.pecas_produzidas, 0) then
    raise exception 'A quantidade de refugo não pode superar a produção apontada'
      using errcode = '23514';
  end if;

  if coalesce(new.pecas_retrabalho, 0) > coalesce(new.pecas_produzidas, 0) then
    raise exception 'A quantidade de retrabalho não pode superar a produção apontada'
      using errcode = '23514';
  end if;

  select op.quantidade
    into v_quantidade_planejada
  from public.ordens_producao op
  where op.id = new.ordem_id
    and op.empresa_id = new.empresa_id
  for update;

  if not found then
    raise exception 'Ordem de produção não encontrada para validar o apontamento'
      using errcode = '23503';
  end if;

  select coalesce(sum(a.pecas_produzidas), 0)::integer
    into v_total_outros
  from public.apontamentos a
  where a.empresa_id = new.empresa_id
    and a.ordem_id = new.ordem_id
    and a.operacao_id = new.operacao_id
    and a.id <> new.id
    and a.status not in ('cancelado', 'cancelada');

  v_quantidade_restante := greatest(v_quantidade_planejada - v_total_outros, 0);

  if new.status in ('cancelado', 'cancelada') then
    return new;
  end if;

  if new.status = 'em_andamento' and v_quantidade_restante = 0 then
    raise exception 'A quantidade planejada desta operação já foi totalmente apontada'
      using errcode = '23514';
  end if;

  if v_total_outros + coalesce(new.pecas_produzidas, 0) > v_quantidade_planejada then
    raise exception 'Quantidade superior ao planejado. Restam % peças para esta operação',
      v_quantidade_restante using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.validar_quantidade_planejada_apontamento()
  from public, anon, authenticated;

create or replace function private.recalcular_ordem_producao(
  p_empresa_id uuid,
  p_ordem_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ordem public.ordens_producao%rowtype;
  v_produto_id uuid;
  v_total_operacoes integer := 0;
  v_operacoes_pendentes integer := 0;
  v_apontamentos_ativos integer := 0;
  v_quantidade_processada integer := 0;
  v_quantidade_aprovada integer := 0;
  v_novo_status text;
  v_tem_apontamento boolean := false;
  v_ultima_finalizacao timestamptz;
begin
  select op.*
    into v_ordem
  from public.ordens_producao op
  where op.id = p_ordem_id
    and op.empresa_id = p_empresa_id
  for update;

  if not found then
    raise exception 'Ordem de produção não encontrada'
      using errcode = '23503';
  end if;

  select p.id
    into v_produto_id
  from public.produtos p
  where p.empresa_id = v_ordem.empresa_id
    and p.codigo = v_ordem.produto_codigo;

  if not found then
    raise exception 'Produto da ordem de produção não encontrado'
      using errcode = '23503';
  end if;

  with operacoes_obrigatorias as (
    select o.id
    from public.operacoes o
    where o.empresa_id = p_empresa_id
      and o.produto_id = v_produto_id
      and coalesce(o.ativo, true)
      and coalesce(o.obrigatoria, true)
  ), totais as (
    select
      o.id,
      coalesce(sum(a.pecas_produzidas) filter (
        where a.status not in ('cancelado', 'cancelada')
      ), 0)::integer as processadas,
      coalesce(sum(greatest(
        coalesce(a.pecas_produzidas, 0) - coalesce(a.pecas_refugo, 0),
        0
      )) filter (
        where a.status not in ('cancelado', 'cancelada')
      ), 0)::integer as aprovadas,
      coalesce(bool_or(a.status = 'em_andamento'), false) as possui_ativo
    from operacoes_obrigatorias o
    left join public.apontamentos a
      on a.empresa_id = p_empresa_id
     and a.ordem_id = p_ordem_id
     and a.operacao_id = o.id
    group by o.id
  )
  select
    count(*)::integer,
    count(*) filter (
      where processadas < v_ordem.quantidade or possui_ativo
    )::integer,
    coalesce(min(least(processadas, v_ordem.quantidade)), 0)::integer,
    coalesce(min(least(aprovadas, v_ordem.quantidade)), 0)::integer
  into
    v_total_operacoes,
    v_operacoes_pendentes,
    v_quantidade_processada,
    v_quantidade_aprovada
  from totais;

  select count(*)::integer
    into v_apontamentos_ativos
  from public.apontamentos a
  where a.empresa_id = p_empresa_id
    and a.ordem_id = p_ordem_id
    and a.status = 'em_andamento';

  select exists (
    select 1
    from public.apontamentos a
    where a.empresa_id = p_empresa_id
      and a.ordem_id = p_ordem_id
      and a.status not in ('cancelado', 'cancelada')
  ) into v_tem_apontamento;

  select max(coalesce(a.finalizado_em, a.created_at))
    into v_ultima_finalizacao
  from public.apontamentos a
  where a.empresa_id = p_empresa_id
    and a.ordem_id = p_ordem_id
    and a.status not in ('em_andamento', 'cancelado', 'cancelada');

  if v_total_operacoes > 0
     and v_operacoes_pendentes = 0
     and v_apontamentos_ativos = 0 then
    v_novo_status := 'encerrada';
  elsif v_tem_apontamento then
    v_novo_status := 'em_andamento';
  elsif v_ordem.status = 'encerrada' then
    v_novo_status := 'em_andamento';
  else
    v_novo_status := v_ordem.status;
  end if;

  update public.ordens_producao
  set quantidade_produzida = v_quantidade_processada,
      quantidade_aprovada = v_quantidade_aprovada,
      status = v_novo_status,
      concluida_em = case
        when v_novo_status = 'encerrada'
          then coalesce(concluida_em, v_ultima_finalizacao, now())
        else null
      end
  where id = p_ordem_id
    and empresa_id = p_empresa_id;

  if v_ordem.status = 'encerrada' and v_novo_status <> 'encerrada' then
    insert into public.production_order_events (
      tenant_id,
      production_order_id,
      event_type,
      event_category,
      source,
      started_at,
      ended_at,
      duration_seconds,
      created_by,
      metadata
    ) values (
      p_empresa_id,
      p_ordem_id,
      'production_order_reopened',
      'production',
      'database_rule',
      now(),
      now(),
      0,
      auth.uid(),
      jsonb_build_object(
        'motivo', 'recalculo_apos_alteracao_ou_cancelamento_de_apontamento',
        'status_anterior', v_ordem.status,
        'status_novo', v_novo_status
      )
    );
  end if;

  return jsonb_build_object(
    'op_status', v_novo_status,
    'quantidade_processada_op', v_quantidade_processada,
    'quantidade_consolidada_op', v_quantidade_aprovada,
    'operacoes_obrigatorias', v_total_operacoes,
    'operacoes_pendentes', v_operacoes_pendentes,
    'apontamentos_ativos', v_apontamentos_ativos
  );
end;
$$;

revoke all on function private.recalcular_ordem_producao(uuid, uuid)
  from public, anon, authenticated;

-- Proteção no banco: nem uma API alternativa nem uma atualização manual via
-- cliente pode marcar a OP como encerrada se o roteiro completo não estiver OK.
create or replace function public.validar_encerramento_ordem_producao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_produto_id uuid;
  v_total_operacoes integer;
  v_operacoes_pendentes integer;
  v_apontamentos_ativos integer;
begin
  if new.status is not distinct from old.status
     or new.status is distinct from 'encerrada' then
    return new;
  end if;

  select p.id
    into v_produto_id
  from public.produtos p
  where p.empresa_id = new.empresa_id
    and p.codigo = new.produto_codigo;

  with operacoes_obrigatorias as (
    select o.id
    from public.operacoes o
    where o.empresa_id = new.empresa_id
      and o.produto_id = v_produto_id
      and coalesce(o.ativo, true)
      and coalesce(o.obrigatoria, true)
  ), totais as (
    select
      o.id,
      coalesce(sum(a.pecas_produzidas) filter (
        where a.status not in ('cancelado', 'cancelada')
      ), 0)::integer as processadas,
      coalesce(bool_or(a.status = 'em_andamento'), false) as possui_ativo
    from operacoes_obrigatorias o
    left join public.apontamentos a
      on a.empresa_id = new.empresa_id
     and a.ordem_id = new.id
     and a.operacao_id = o.id
    group by o.id
  )
  select
    count(*)::integer,
    count(*) filter (
      where processadas < new.quantidade or possui_ativo
    )::integer
  into v_total_operacoes, v_operacoes_pendentes
  from totais;

  select count(*)::integer
    into v_apontamentos_ativos
  from public.apontamentos a
  where a.empresa_id = new.empresa_id
    and a.ordem_id = new.id
    and a.status = 'em_andamento';

  if coalesce(v_total_operacoes, 0) = 0 then
    raise exception 'A OP não pode ser encerrada sem operações obrigatórias ativas no roteiro'
      using errcode = '23514';
  end if;

  if coalesce(v_operacoes_pendentes, 0) > 0 then
    raise exception 'A OP possui % operação(ões) obrigatória(s) pendente(s) ou em andamento',
      v_operacoes_pendentes using errcode = '23514';
  end if;

  if coalesce(v_apontamentos_ativos, 0) > 0 then
    raise exception 'A OP possui % apontamento(s) ativo(s)', v_apontamentos_ativos
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists ordens_producao_validar_encerramento
  on public.ordens_producao;
create trigger ordens_producao_validar_encerramento
before update of status on public.ordens_producao
for each row execute function public.validar_encerramento_ordem_producao();

revoke all on function public.validar_encerramento_ordem_producao()
  from public, anon, authenticated;

create or replace function private.recalcular_op_apos_apontamento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.recalcular_ordem_producao(old.empresa_id, old.ordem_id);
    return old;
  end if;

  if tg_op = 'UPDATE'
     and (old.empresa_id, old.ordem_id) is distinct from (new.empresa_id, new.ordem_id) then
    perform private.recalcular_ordem_producao(old.empresa_id, old.ordem_id);
  end if;

  perform private.recalcular_ordem_producao(new.empresa_id, new.ordem_id);
  return new;
end;
$$;

drop trigger if exists apontamentos_recalcular_op_insert_delete
  on public.apontamentos;
create trigger apontamentos_recalcular_op_insert_delete
after insert or delete on public.apontamentos
for each row execute function private.recalcular_op_apos_apontamento();

drop trigger if exists apontamentos_recalcular_op_update
  on public.apontamentos;
create trigger apontamentos_recalcular_op_update
after update of empresa_id, ordem_id, operacao_id, pecas_produzidas, pecas_refugo, status
on public.apontamentos
for each row execute function private.recalcular_op_apos_apontamento();

revoke all on function private.recalcular_op_apos_apontamento()
  from public, anon, authenticated;

-- Mantém a assinatura antiga para clientes já publicados, mas passa a creditar
-- somente o delta consolidado ainda não levado ao estoque. O valor recebido do
-- navegador nunca define quantas peças acabadas serão movimentadas.
create or replace function public.finalizar_apontamento_estoque(
  p_empresa_id uuid,
  p_apontamento_id uuid,
  p_ordem_id uuid,
  p_produto_codigo text,
  p_pecas_boas integer,
  p_refugo integer,
  p_observacao text default null
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
  v_produto public.produtos%rowtype;
  v_item record;
  v_insumo_produto public.insumos%rowtype;
  v_saldo_anterior numeric;
  v_saldo_posterior numeric;
  v_custo_medio numeric;
  v_custo_produto numeric := 0;
  v_novo_custo_medio numeric;
  v_consumo numeric;
  v_quantidade_creditar integer;
  v_avisos jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'Sessão expirada' using errcode = '28000';
  end if;

  if p_empresa_id is null or p_apontamento_id is null or p_ordem_id is null then
    raise exception 'Empresa, apontamento e ordem são obrigatórios' using errcode = '22004';
  end if;

  select a.*
    into v_apontamento
  from public.apontamentos a
  where a.id = p_apontamento_id
    and a.empresa_id = p_empresa_id
    and a.ordem_id = p_ordem_id
    and a.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Apontamento não encontrado ou não pertence ao operador atual'
      using errcode = '42501';
  end if;

  if v_apontamento.status = 'em_andamento' then
    raise exception 'O apontamento ainda não foi finalizado'
      using errcode = '23514';
  end if;

  if p_pecas_boas <> greatest(
       coalesce(v_apontamento.pecas_produzidas, 0) - coalesce(v_apontamento.pecas_refugo, 0),
       0
     ) or p_refugo <> coalesce(v_apontamento.pecas_refugo, 0) then
    raise exception 'As quantidades divergem do apontamento salvo' using errcode = '23514';
  end if;

  select op.*
    into v_ordem
  from public.ordens_producao op
  where op.id = p_ordem_id
    and op.empresa_id = p_empresa_id
    and op.produto_codigo = p_produto_codigo
  for update;

  if not found then
    raise exception 'Ordem de produção e produto não correspondem' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.movimentacoes_estoque m
    where m.empresa_id = p_empresa_id
      and m.referencia_id = p_apontamento_id
      and m.origem = 'producao'
  ) then
    return jsonb_build_object(
      'processado', true,
      'idempotente', true,
      'quantidade_creditada', 0,
      'avisos', v_avisos
    );
  end if;

  v_quantidade_creditar := greatest(
    coalesce(v_ordem.quantidade_aprovada, 0) -
      coalesce(v_ordem.quantidade_aprovada_estoque, 0),
    0
  );

  if v_quantidade_creditar = 0 then
    return jsonb_build_object(
      'processado', false,
      'idempotente', true,
      'motivo', 'sem_novo_produto_acabado',
      'quantidade_creditada', 0,
      'avisos', v_avisos
    );
  end if;

  select p.*
    into v_produto
  from public.produtos p
  where p.empresa_id = p_empresa_id
    and p.codigo = p_produto_codigo;

  if not found then
    raise exception 'Produto não encontrado' using errcode = '23503';
  end if;

  if not exists (
    select 1
    from public.bom_itens b
    where b.empresa_id = p_empresa_id
      and b.produto_codigo = p_produto_codigo
  ) then
    return jsonb_build_object(
      'processado', false,
      'idempotente', false,
      'motivo', 'bom_ausente',
      'quantidade_creditada', 0,
      'avisos', v_avisos
    );
  end if;

  for v_item in
    select
      b.insumo_id,
      sum(b.quantidade) as quantidade_por_peca,
      i.codigo,
      i.preco_unitario
    from public.bom_itens b
    join public.insumos i
      on i.id = b.insumo_id
     and i.empresa_id = b.empresa_id
    where b.empresa_id = p_empresa_id
      and b.produto_codigo = p_produto_codigo
    group by b.insumo_id, i.codigo, i.preco_unitario
    order by b.insumo_id
  loop
    v_consumo := v_item.quantidade_por_peca * v_quantidade_creditar;

    insert into public.saldo_estoque (
      empresa_id, insumo_id, saldo_atual, custo_medio, valor_total, updated_at
    ) values (
      p_empresa_id, v_item.insumo_id, 0, coalesce(v_item.preco_unitario, 0), 0, now()
    )
    on conflict (empresa_id, insumo_id) do nothing;

    select s.saldo_atual, s.custo_medio
      into v_saldo_anterior, v_custo_medio
    from public.saldo_estoque s
    where s.empresa_id = p_empresa_id
      and s.insumo_id = v_item.insumo_id
    for update;

    v_saldo_posterior := v_saldo_anterior - v_consumo;
    v_custo_produto := v_custo_produto +
      (v_item.quantidade_por_peca * v_custo_medio);

    update public.saldo_estoque
    set saldo_atual = v_saldo_posterior,
        valor_total = v_saldo_posterior * v_custo_medio,
        updated_at = now()
    where empresa_id = p_empresa_id
      and insumo_id = v_item.insumo_id;

    insert into public.movimentacoes_estoque (
      empresa_id, insumo_id, tipo, quantidade, quantidade_anterior,
      quantidade_posterior, origem, referencia_id, observacao, created_by,
      custo_unitario, valor_total
    ) values (
      p_empresa_id, v_item.insumo_id, 'saida', v_consumo, v_saldo_anterior,
      v_saldo_posterior, 'producao', p_apontamento_id, p_observacao, v_user_id,
      v_custo_medio, v_consumo * v_custo_medio
    );

    if v_saldo_anterior < v_consumo then
      v_avisos := v_avisos || jsonb_build_array(jsonb_build_object(
        'insumo', v_item.codigo,
        'consumo', v_consumo,
        'disponivel', v_saldo_anterior
      ));
    end if;
  end loop;

  insert into public.insumos (
    empresa_id, codigo, descricao, unidade_medida, preco_unitario,
    estoque_minimo, tipo
  ) values (
    p_empresa_id, v_produto.codigo, v_produto.descricao, 'un',
    v_custo_produto, 0, 'produto_acabado'
  )
  on conflict (empresa_id, codigo) do update
    set descricao = excluded.descricao
  returning * into v_insumo_produto;

  if v_insumo_produto.tipo <> 'produto_acabado' then
    raise exception 'O código do produto já está cadastrado no estoque com outro tipo'
      using errcode = '23505';
  end if;

  insert into public.saldo_estoque (
    empresa_id, insumo_id, saldo_atual, custo_medio, valor_total, updated_at
  ) values (
    p_empresa_id, v_insumo_produto.id, 0, v_custo_produto, 0, now()
  )
  on conflict (empresa_id, insumo_id) do nothing;

  select s.saldo_atual, s.custo_medio
    into v_saldo_anterior, v_custo_medio
  from public.saldo_estoque s
  where s.empresa_id = p_empresa_id
    and s.insumo_id = v_insumo_produto.id
  for update;

  v_saldo_posterior := v_saldo_anterior + v_quantidade_creditar;
  v_novo_custo_medio := case
    when v_saldo_anterior <= 0 then v_custo_produto
    when v_saldo_posterior = 0 then v_custo_medio
    else (
      (v_saldo_anterior * v_custo_medio) +
      (v_quantidade_creditar * v_custo_produto)
    ) / v_saldo_posterior
  end;

  update public.saldo_estoque
  set saldo_atual = v_saldo_posterior,
      custo_medio = v_novo_custo_medio,
      valor_total = v_saldo_posterior * v_novo_custo_medio,
      updated_at = now()
  where empresa_id = p_empresa_id
    and insumo_id = v_insumo_produto.id;

  insert into public.movimentacoes_estoque (
    empresa_id, insumo_id, tipo, quantidade, quantidade_anterior,
    quantidade_posterior, origem, referencia_id, observacao, created_by,
    custo_unitario, valor_total
  ) values (
    p_empresa_id, v_insumo_produto.id, 'entrada', v_quantidade_creditar,
    v_saldo_anterior, v_saldo_posterior, 'producao', p_apontamento_id,
    p_observacao, v_user_id, v_custo_produto,
    v_quantidade_creditar * v_custo_produto
  );

  update public.ordens_producao
  set quantidade_aprovada_estoque = quantidade_aprovada_estoque + v_quantidade_creditar
  where id = p_ordem_id
    and empresa_id = p_empresa_id;

  return jsonb_build_object(
    'processado', true,
    'idempotente', false,
    'quantidade_creditada', v_quantidade_creditar,
    'avisos', v_avisos
  );
end;
$$;

revoke all on function public.finalizar_apontamento_estoque(
  uuid, uuid, uuid, text, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.finalizar_apontamento_estoque(
  uuid, uuid, uuid, text, integer, integer, text
) to authenticated;

comment on function public.finalizar_apontamento_estoque(
  uuid, uuid, uuid, text, integer, integer, text
) is 'Compatibilidade: movimenta somente o delta consolidado da OP, com trava e idempotência.';

create or replace function public.finalizar_apontamento_producao(
  p_empresa_id uuid,
  p_apontamento_id uuid,
  p_quantidade_processada integer,
  p_quantidade_refugo integer default 0,
  p_quantidade_retrabalho integer default 0,
  p_cronometro_total_segundos integer default 0,
  p_observacao text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_agora timestamptz := now();
  v_fuso text;
  v_apontamento public.apontamentos%rowtype;
  v_ordem public.ordens_producao%rowtype;
  v_total_outros integer;
  v_total_operacao integer;
  v_aprovadas_operacao integer;
  v_possui_ativo_operacao boolean;
  v_status_apontamento text;
  v_status_operacao text;
  v_estado_op jsonb;
  v_estoque jsonb := jsonb_build_object(
    'processado', false,
    'idempotente', true,
    'quantidade_creditada', 0,
    'avisos', '[]'::jsonb
  );
begin
  if v_user_id is null then
    raise exception 'Sessão expirada' using errcode = '28000';
  end if;

  if p_quantidade_processada < 0
     or p_quantidade_refugo < 0
     or p_quantidade_retrabalho < 0
     or p_cronometro_total_segundos < 0 then
    raise exception 'As quantidades e o tempo não podem ser negativos'
      using errcode = '22023';
  end if;

  if p_quantidade_refugo > p_quantidade_processada then
    raise exception 'O refugo não pode superar a quantidade processada'
      using errcode = '23514';
  end if;

  if p_quantidade_retrabalho > p_quantidade_processada then
    raise exception 'O retrabalho não pode superar a quantidade processada'
      using errcode = '23514';
  end if;

  select a.*
    into v_apontamento
  from public.apontamentos a
  where a.id = p_apontamento_id
    and a.empresa_id = p_empresa_id
    and a.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Apontamento não encontrado ou não pertence ao operador atual'
      using errcode = '42501';
  end if;

  select op.*
    into v_ordem
  from public.ordens_producao op
  where op.id = v_apontamento.ordem_id
    and op.empresa_id = p_empresa_id
  for update;

  if not found then
    raise exception 'Ordem de produção não encontrada' using errcode = '23503';
  end if;

  if v_apontamento.status <> 'em_andamento' then
    if coalesce(v_apontamento.pecas_produzidas, 0) <> p_quantidade_processada
       or coalesce(v_apontamento.pecas_refugo, 0) <> p_quantidade_refugo
       or coalesce(v_apontamento.pecas_retrabalho, 0) <> p_quantidade_retrabalho then
      raise exception 'O apontamento já foi finalizado com quantidades diferentes'
        using errcode = '23505';
    end if;

    v_estado_op := private.recalcular_ordem_producao(
      p_empresa_id,
      v_apontamento.ordem_id
    );

    select
      coalesce(sum(a.pecas_produzidas) filter (
        where a.status not in ('cancelado', 'cancelada')
      ), 0)::integer,
      coalesce(sum(greatest(
        coalesce(a.pecas_produzidas, 0) - coalesce(a.pecas_refugo, 0),
        0
      )) filter (
        where a.status not in ('cancelado', 'cancelada')
      ), 0)::integer,
      coalesce(bool_or(a.status = 'em_andamento'), false)
    into v_total_operacao, v_aprovadas_operacao, v_possui_ativo_operacao
    from public.apontamentos a
    where a.empresa_id = p_empresa_id
      and a.ordem_id = v_apontamento.ordem_id
      and a.operacao_id = v_apontamento.operacao_id;

    v_status_operacao := case
      when v_possui_ativo_operacao then 'em_andamento'
      when v_total_operacao >= v_ordem.quantidade then 'concluida'
      when v_total_operacao > 0 then 'parcialmente_concluida'
      else 'pendente'
    end;

    return jsonb_build_object(
      'success', true,
      'idempotente', true,
      'apontamento_status', 'finalizado',
      'apontamento_status_banco', v_apontamento.status,
      'operacao_status', v_status_operacao,
      'quantidade_operacao', v_total_operacao,
      'quantidade_aprovada_operacao', v_aprovadas_operacao,
      'op_status', v_estado_op ->> 'op_status',
      'quantidade_consolidada_op',
        (v_estado_op ->> 'quantidade_consolidada_op')::integer,
      'quantidade_processada_op',
        (v_estado_op ->> 'quantidade_processada_op')::integer,
      'operacoes_pendentes',
        (v_estado_op ->> 'operacoes_pendentes')::integer,
      'apontamentos_ativos',
        (v_estado_op ->> 'apontamentos_ativos')::integer,
      'avisos', '[]'::jsonb
    );
  end if;

  if p_cronometro_total_segundos < coalesce(v_apontamento.cronometro_total_segundos, 0) then
    raise exception 'O tempo final não pode ser menor que o tempo já registrado'
      using errcode = '23514';
  end if;

  select coalesce(sum(a.pecas_produzidas), 0)::integer
    into v_total_outros
  from public.apontamentos a
  where a.empresa_id = p_empresa_id
    and a.ordem_id = v_apontamento.ordem_id
    and a.operacao_id = v_apontamento.operacao_id
    and a.id <> v_apontamento.id
    and a.status not in ('cancelado', 'cancelada');

  if v_total_outros + p_quantidade_processada > v_ordem.quantidade then
    raise exception 'Quantidade superior ao planejado. Restam % peças para esta operação',
      greatest(v_ordem.quantidade - v_total_outros, 0)
      using errcode = '23514';
  end if;

  v_status_apontamento := case
    when v_total_outros + p_quantidade_processada >= v_ordem.quantidade
      then 'fechado'
    else 'aberto'
  end;
  v_fuso := coalesce(private.fuso_empresa(p_empresa_id), 'America/Sao_Paulo');

  update public.apontamento_pausas
  set fim = coalesce(fim, v_agora)
  where apontamento_id = v_apontamento.id
    and fim is null;

  update public.apontamentos
  set cronometro_total_segundos = p_cronometro_total_segundos,
      pecas_produzidas = p_quantidade_processada,
      pecas_refugo = p_quantidade_refugo,
      pecas_retrabalho = p_quantidade_retrabalho,
      status = v_status_apontamento,
      encerramento = case
        when v_status_apontamento = 'fechado' then 'encerrar'
        else 'continuar'
      end,
      hora_fim = (v_agora at time zone v_fuso)::time(0),
      finalizado_em = v_agora,
      finalizado_por = v_user_id
  where id = v_apontamento.id;

  v_estado_op := private.recalcular_ordem_producao(
    p_empresa_id,
    v_apontamento.ordem_id
  );

  if p_quantidade_processada - p_quantidade_refugo > 0 then
    v_estoque := public.finalizar_apontamento_estoque(
      p_empresa_id,
      v_apontamento.id,
      v_apontamento.ordem_id,
      v_ordem.produto_codigo,
      p_quantidade_processada - p_quantidade_refugo,
      p_quantidade_refugo,
      coalesce(
        p_observacao,
        format(
          'OP %s — avanço consolidado do roteiro',
          coalesce(v_ordem.numero_op, v_ordem.id::text)
        )
      )
    );
  end if;

  select
    coalesce(sum(a.pecas_produzidas) filter (
      where a.status not in ('cancelado', 'cancelada')
    ), 0)::integer,
    coalesce(sum(greatest(
      coalesce(a.pecas_produzidas, 0) - coalesce(a.pecas_refugo, 0),
      0
    )) filter (
      where a.status not in ('cancelado', 'cancelada')
    ), 0)::integer,
    coalesce(bool_or(a.status = 'em_andamento'), false)
  into v_total_operacao, v_aprovadas_operacao, v_possui_ativo_operacao
  from public.apontamentos a
  where a.empresa_id = p_empresa_id
    and a.ordem_id = v_apontamento.ordem_id
    and a.operacao_id = v_apontamento.operacao_id;

  v_status_operacao := case
    when v_possui_ativo_operacao then 'em_andamento'
    when v_total_operacao >= v_ordem.quantidade then 'concluida'
    when v_total_operacao > 0 then 'parcialmente_concluida'
    else 'pendente'
  end;

  insert into public.production_order_events (
    tenant_id,
    production_order_id,
    operation_id,
    workstation_id,
    machine_id,
    operator_id,
    apontamento_id,
    event_type,
    event_category,
    source,
    started_at,
    ended_at,
    duration_seconds,
    created_by,
    metadata
  ) values (
    p_empresa_id,
    v_apontamento.ordem_id,
    v_apontamento.operacao_id,
    v_apontamento.maquina_id,
    v_apontamento.maquina_id,
    v_user_id,
    v_apontamento.id,
    'production_report_finalized',
    'production',
    'operator',
    v_agora,
    v_agora,
    0,
    v_user_id,
    jsonb_build_object(
      'quantidade_processada', p_quantidade_processada,
      'quantidade_aprovada', p_quantidade_processada - p_quantidade_refugo,
      'quantidade_refugo', p_quantidade_refugo,
      'quantidade_retrabalho', p_quantidade_retrabalho,
      'status_apontamento_anterior', v_apontamento.status,
      'status_apontamento_novo', v_status_apontamento,
      'status_operacao_novo', v_status_operacao,
      'status_op_anterior', v_ordem.status,
      'status_op_novo', v_estado_op ->> 'op_status'
    )
  )
  on conflict do nothing;

  return jsonb_build_object(
    'success', true,
    'idempotente', false,
    'apontamento_status', 'finalizado',
    'apontamento_status_banco', v_status_apontamento,
    'operacao_status', v_status_operacao,
    'op_status', v_estado_op ->> 'op_status',
    'quantidade_operacao', v_total_operacao,
    'quantidade_aprovada_operacao', v_aprovadas_operacao,
    'quantidade_consolidada_op',
      (v_estado_op ->> 'quantidade_consolidada_op')::integer,
    'quantidade_processada_op',
      (v_estado_op ->> 'quantidade_processada_op')::integer,
    'operacoes_pendentes',
      (v_estado_op ->> 'operacoes_pendentes')::integer,
    'apontamentos_ativos',
      (v_estado_op ->> 'apontamentos_ativos')::integer,
    'quantidade_creditada_estoque',
      coalesce((v_estoque ->> 'quantidade_creditada')::integer, 0),
    'avisos', coalesce(v_estoque -> 'avisos', '[]'::jsonb)
  );
end;
$$;

revoke all on function public.finalizar_apontamento_producao(
  uuid, uuid, integer, integer, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.finalizar_apontamento_producao(
  uuid, uuid, integer, integer, integer, integer, text
) to authenticated;

comment on function public.finalizar_apontamento_producao(
  uuid, uuid, integer, integer, integer, integer, text
) is 'Finaliza um apontamento com lock, idempotência, consolidação da OP, estoque e auditoria na mesma transação.';

-- Preserva o estoque já creditado antes desta migration e evita nova entrada
-- das mesmas peças quando um cliente antigo repetir a chamada legada.
update public.ordens_producao op
set quantidade_aprovada_estoque = coalesce((
  select sum(m.quantidade)::integer
  from public.movimentacoes_estoque m
  join public.apontamentos a
    on a.id = m.referencia_id
   and a.empresa_id = m.empresa_id
  join public.insumos i
    on i.id = m.insumo_id
   and i.empresa_id = m.empresa_id
  where m.empresa_id = op.empresa_id
    and a.ordem_id = op.id
    and m.origem = 'producao'
    and m.tipo in ('entrada', 'entrada_producao')
    and i.codigo = op.produto_codigo
), 0);

-- Recalcula os registros antigos sem somar quantidades de operações diferentes.
do $$
declare
  v_ordem record;
begin
  for v_ordem in
    select id, empresa_id
    from public.ordens_producao
    order by empresa_id, id
  loop
    perform private.recalcular_ordem_producao(v_ordem.empresa_id, v_ordem.id);
  end loop;
end;
$$;

notify pgrst, 'reload schema';

commit;

-- Reversão operacional:
-- 1. restaurar o frontend anterior;
-- 2. remover os triggers ordens_producao_validar_encerramento e
--    apontamentos_recalcular_op_*;
-- 3. restaurar as funções da migration 20260801195731;
-- 4. as colunas novas podem permanecer (são aditivas e preservam histórico).
