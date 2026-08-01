-- Garante uma única posição de estoque por empresa/item e permite UPSERTs
-- atômicos durante finalizações concorrentes.
create unique index if not exists saldo_estoque_empresa_insumo_uidx
  on public.saldo_estoque (empresa_id, insumo_id);

-- O produto acabado é representado no estoque pelo mesmo código do cadastro
-- de produtos. A unicidade evita itens duplicados quando duas OPs finalizam juntas.
create unique index if not exists insumos_empresa_codigo_uidx
  on public.insumos (empresa_id, codigo);

-- Uma movimentação de produção pertence a um apontamento específico. Além de
-- auditoria, este índice torna a função idempotente em caso de repetição da RPC.
create unique index if not exists movimentacoes_producao_apontamento_item_uidx
  on public.movimentacoes_estoque (
    empresa_id,
    referencia_id,
    insumo_id,
    tipo
  )
  where origem = 'producao' and referencia_id is not null;

create index if not exists apontamentos_quantidade_operacao_idx
  on public.apontamentos (empresa_id, ordem_id, operacao_id)
  include (pecas_produzidas, status);

-- Serializa os apontamentos pela OP e impede que duas finalizações concorrentes
-- ultrapassem, juntas, a quantidade planejada da mesma operação.
create or replace function public.validar_quantidade_planejada_apontamento()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
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
    raise exception 'As quantidades do apontamento não podem ser negativas' using errcode = '22023';
  end if;

  if coalesce(new.pecas_refugo, 0) > coalesce(new.pecas_produzidas, 0) then
    raise exception 'A quantidade de refugo não pode superar a produção apontada' using errcode = '23514';
  end if;

  if coalesce(new.pecas_retrabalho, 0) > coalesce(new.pecas_produzidas, 0) then
    raise exception 'A quantidade de retrabalho não pode superar a produção apontada' using errcode = '23514';
  end if;

  select op.quantidade
    into v_quantidade_planejada
  from public.ordens_producao op
  where op.id = new.ordem_id
    and op.empresa_id = new.empresa_id
  for update;

  if not found then
    raise exception 'Ordem de produção não encontrada para validar o apontamento' using errcode = '23503';
  end if;

  select coalesce(sum(a.pecas_produzidas), 0)::integer
    into v_total_outros
  from public.apontamentos a
  where a.empresa_id = new.empresa_id
    and a.ordem_id = new.ordem_id
    and a.operacao_id = new.operacao_id
    and a.id <> new.id
    and a.status is distinct from 'cancelado';

  v_quantidade_restante := greatest(v_quantidade_planejada - v_total_outros, 0);

  if new.status = 'em_andamento' and v_quantidade_restante = 0 then
    raise exception 'A quantidade planejada desta operação já foi totalmente apontada' using errcode = '23514';
  end if;

  if v_total_outros + coalesce(new.pecas_produzidas, 0) > v_quantidade_planejada then
    raise exception 'Quantidade superior ao planejado. Restam % peças para esta operação', v_quantidade_restante
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists apontamentos_validar_quantidade_planejada_insert on public.apontamentos;
create trigger apontamentos_validar_quantidade_planejada_insert
before insert on public.apontamentos
for each row execute function public.validar_quantidade_planejada_apontamento();

drop trigger if exists apontamentos_validar_quantidade_planejada_update on public.apontamentos;
create trigger apontamentos_validar_quantidade_planejada_update
before update of empresa_id, ordem_id, operacao_id, pecas_produzidas, pecas_refugo, pecas_retrabalho, status
on public.apontamentos
for each row execute function public.validar_quantidade_planejada_apontamento();

revoke all on function public.validar_quantidade_planejada_apontamento()
  from public, anon, authenticated;

-- Somente a última operação encerra a OP. O encerramento acontece por decisão
-- explícita ou quando o acumulado chega exatamente à meta (o excedente é barrado antes).
create or replace function public.encerrar_op_ao_atingir_planejado()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_quantidade_planejada integer;
  v_produto_id uuid;
  v_ultima_operacao_id uuid;
  v_total_operacao integer;
begin
  if new.empresa_id is null or new.operacao_id is null or new.status = 'em_andamento' then
    return new;
  end if;

  select op.quantidade, p.id
    into v_quantidade_planejada, v_produto_id
  from public.ordens_producao op
  join public.produtos p
    on p.empresa_id = op.empresa_id
   and p.codigo = op.produto_codigo
  where op.id = new.ordem_id
    and op.empresa_id = new.empresa_id;

  if not found then
    return new;
  end if;

  select o.id
    into v_ultima_operacao_id
  from public.operacoes o
  where o.empresa_id = new.empresa_id
    and o.produto_id = v_produto_id
  order by o.ordem desc nulls last, o.id
  limit 1;

  if v_ultima_operacao_id is distinct from new.operacao_id then
    return new;
  end if;

  select coalesce(sum(a.pecas_produzidas), 0)::integer
    into v_total_operacao
  from public.apontamentos a
  where a.empresa_id = new.empresa_id
    and a.ordem_id = new.ordem_id
    and a.operacao_id = new.operacao_id
    and a.status is distinct from 'cancelado';

  if new.encerramento = 'encerrar' or v_total_operacao >= v_quantidade_planejada then
    update public.ordens_producao
    set status = 'encerrada'
    where id = new.ordem_id
      and empresa_id = new.empresa_id;
  end if;

  return new;
end;
$$;

drop trigger if exists apontamentos_encerrar_op_ao_atingir_planejado on public.apontamentos;
create trigger apontamentos_encerrar_op_ao_atingir_planejado
after update of pecas_produzidas, status, encerramento on public.apontamentos
for each row execute function public.encerrar_op_ao_atingir_planejado();

revoke all on function public.encerrar_op_ao_atingir_planejado()
  from public, anon, authenticated;

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
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_apontamento public.apontamentos%rowtype;
  v_produto public.produtos%rowtype;
  v_item record;
  v_insumo_produto public.insumos%rowtype;
  v_saldo_anterior numeric;
  v_saldo_posterior numeric;
  v_custo_medio numeric;
  v_custo_produto numeric := 0;
  v_novo_custo_medio numeric;
  v_consumo numeric;
  v_avisos jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'Sessão expirada' using errcode = '28000';
  end if;

  if p_empresa_id is null or p_apontamento_id is null or p_ordem_id is null then
    raise exception 'Empresa, apontamento e ordem são obrigatórios' using errcode = '22004';
  end if;

  if p_pecas_boas <= 0 or p_refugo < 0 then
    raise exception 'As quantidades informadas são inválidas' using errcode = '22023';
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
    raise exception 'Apontamento não encontrado ou não pertence ao operador atual' using errcode = '42501';
  end if;

  if v_apontamento.status not in ('aberto', 'fechado')
     or v_apontamento.encerramento not in ('continuar', 'encerrar', 'encerrar_parcial') then
    raise exception 'O apontamento ainda não está pronto para movimentar estoque' using errcode = '23514';
  end if;

  if p_pecas_boas <> greatest(v_apontamento.pecas_produzidas - v_apontamento.pecas_refugo, 0)
     or p_refugo <> v_apontamento.pecas_refugo then
    raise exception 'As quantidades divergem do apontamento salvo' using errcode = '23514';
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
      'avisos', v_avisos
    );
  end if;

  select p.*
    into v_produto
  from public.produtos p
  join public.ordens_producao op
    on op.id = p_ordem_id
   and op.empresa_id = p.empresa_id
   and op.produto_codigo = p.codigo
  where p.empresa_id = p_empresa_id
    and p.codigo = p_produto_codigo;

  if not found then
    raise exception 'Produto e ordem de produção não correspondem' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.bom_itens b
    where b.empresa_id = p_empresa_id
      and b.produto_codigo = p_produto_codigo
  ) then
    return jsonb_build_object(
      'processado', false,
      'motivo', 'bom_ausente',
      'avisos', v_avisos
    );
  end if;

  -- Processa os insumos em ordem estável para reduzir risco de deadlock quando
  -- diversas OPs forem encerradas simultaneamente.
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
    v_consumo := v_item.quantidade_por_peca * p_pecas_boas;

    insert into public.saldo_estoque (
      empresa_id,
      insumo_id,
      saldo_atual,
      custo_medio,
      valor_total,
      updated_at
    ) values (
      p_empresa_id,
      v_item.insumo_id,
      0,
      coalesce(v_item.preco_unitario, 0),
      0,
      now()
    )
    on conflict (empresa_id, insumo_id) do nothing;

    select s.saldo_atual, s.custo_medio
      into v_saldo_anterior, v_custo_medio
    from public.saldo_estoque s
    where s.empresa_id = p_empresa_id
      and s.insumo_id = v_item.insumo_id
    for update;

    v_saldo_posterior := v_saldo_anterior - v_consumo;
    v_custo_produto := v_custo_produto + (v_item.quantidade_por_peca * v_custo_medio);

    update public.saldo_estoque
    set saldo_atual = v_saldo_posterior,
        valor_total = v_saldo_posterior * v_custo_medio,
        updated_at = now()
    where empresa_id = p_empresa_id
      and insumo_id = v_item.insumo_id;

    insert into public.movimentacoes_estoque (
      empresa_id,
      insumo_id,
      tipo,
      quantidade,
      quantidade_anterior,
      quantidade_posterior,
      origem,
      referencia_id,
      observacao,
      created_by,
      custo_unitario,
      valor_total
    ) values (
      p_empresa_id,
      v_item.insumo_id,
      'saida',
      v_consumo,
      v_saldo_anterior,
      v_saldo_posterior,
      'producao',
      p_apontamento_id,
      p_observacao,
      v_user_id,
      v_custo_medio,
      v_consumo * v_custo_medio
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
    empresa_id,
    codigo,
    descricao,
    unidade_medida,
    preco_unitario,
    estoque_minimo,
    tipo
  ) values (
    p_empresa_id,
    v_produto.codigo,
    v_produto.descricao,
    'un',
    v_custo_produto,
    0,
    'produto_acabado'
  )
  on conflict (empresa_id, codigo) do update
    set descricao = excluded.descricao
  returning * into v_insumo_produto;

  if v_insumo_produto.tipo <> 'produto_acabado' then
    raise exception 'O código do produto já está cadastrado no estoque com outro tipo' using errcode = '23505';
  end if;

  insert into public.saldo_estoque (
    empresa_id,
    insumo_id,
    saldo_atual,
    custo_medio,
    valor_total,
    updated_at
  ) values (
    p_empresa_id,
    v_insumo_produto.id,
    0,
    v_custo_produto,
    0,
    now()
  )
  on conflict (empresa_id, insumo_id) do nothing;

  select s.saldo_atual, s.custo_medio
    into v_saldo_anterior, v_custo_medio
  from public.saldo_estoque s
  where s.empresa_id = p_empresa_id
    and s.insumo_id = v_insumo_produto.id
  for update;

  v_saldo_posterior := v_saldo_anterior + p_pecas_boas;
  v_novo_custo_medio := case
    when v_saldo_anterior <= 0 then v_custo_produto
    when v_saldo_posterior = 0 then v_custo_medio
    else ((v_saldo_anterior * v_custo_medio) + (p_pecas_boas * v_custo_produto)) / v_saldo_posterior
  end;

  update public.saldo_estoque
  set saldo_atual = v_saldo_posterior,
      custo_medio = v_novo_custo_medio,
      valor_total = v_saldo_posterior * v_novo_custo_medio,
      updated_at = now()
  where empresa_id = p_empresa_id
    and insumo_id = v_insumo_produto.id;

  insert into public.movimentacoes_estoque (
    empresa_id,
    insumo_id,
    tipo,
    quantidade,
    quantidade_anterior,
    quantidade_posterior,
    origem,
    referencia_id,
    observacao,
    created_by,
    custo_unitario,
    valor_total
  ) values (
    p_empresa_id,
    v_insumo_produto.id,
    'entrada',
    p_pecas_boas,
    v_saldo_anterior,
    v_saldo_posterior,
    'producao',
    p_apontamento_id,
    p_observacao,
    v_user_id,
    v_custo_produto,
    p_pecas_boas * v_custo_produto
  );

  return jsonb_build_object(
    'processado', true,
    'idempotente', false,
    'avisos', v_avisos
  );
end;
$$;

revoke all on function public.finalizar_apontamento_estoque(uuid, uuid, uuid, text, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.finalizar_apontamento_estoque(uuid, uuid, uuid, text, integer, integer, text)
  to authenticated;

comment on function public.finalizar_apontamento_estoque(uuid, uuid, uuid, text, integer, integer, text)
  is 'Movimenta BOM e produto acabado de forma atômica e idempotente por apontamento concluído.';
