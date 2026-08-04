-- Integridade do fluxo GBO -> OP -> apontamento -> estoque.
--
-- Esta migration e deliberadamente aditiva para os dados legados: constraints
-- NOT VALID passam a proteger novas escritas sem apagar ou reatribuir os
-- apontamentos orfaos identificados pela auditoria de 2026-08-04.

begin;

-- Falha rapidamente se outra sessao estiver segurando locks nas tabelas
-- criticas; evita que a implantacao forme uma fila invisivel em producao.
set local lock_timeout = '3s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- Identidade, tenant e idempotencia dos apontamentos
-- ---------------------------------------------------------------------------

alter table public.apontamentos
  add column if not exists command_id uuid;

alter table public.apontamentos alter column empresa_id set not null;
alter table public.apontamentos alter column operacao_id set not null;
alter table public.apontamentos alter column maquina_id set not null;
alter table public.ordens_producao alter column empresa_id set not null;
alter table public.produtos alter column empresa_id set not null;
alter table public.maquinas alter column empresa_id set not null;

create unique index if not exists apontamentos_command_id_uidx
  on public.apontamentos (empresa_id, command_id)
  where command_id is not null;

create unique index if not exists apontamentos_contexto_ativo_uidx
  on public.apontamentos (
    empresa_id, user_id, ordem_id, operacao_id, maquina_id
  )
  where status = 'em_andamento';

create unique index if not exists ordens_producao_empresa_id_id_uidx
  on public.ordens_producao (empresa_id, id);
create unique index if not exists operacoes_empresa_id_id_uidx
  on public.operacoes (empresa_id, id);
create unique index if not exists maquinas_empresa_id_id_uidx
  on public.maquinas (empresa_id, id);
create unique index if not exists produtos_empresa_id_id_uidx
  on public.produtos (empresa_id, id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.apontamentos'::regclass
      and conname = 'apontamentos_ordem_empresa_fkey'
  ) then
    alter table public.apontamentos
      add constraint apontamentos_ordem_empresa_fkey
      foreign key (empresa_id, ordem_id)
      references public.ordens_producao (empresa_id, id)
      on delete restrict not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.apontamentos'::regclass
      and conname = 'apontamentos_operacao_empresa_fkey'
  ) then
    alter table public.apontamentos
      add constraint apontamentos_operacao_empresa_fkey
      foreign key (empresa_id, operacao_id)
      references public.operacoes (empresa_id, id)
      on delete restrict not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.apontamentos'::regclass
      and conname = 'apontamentos_maquina_empresa_fkey'
  ) then
    alter table public.apontamentos
      add constraint apontamentos_maquina_empresa_fkey
      foreign key (empresa_id, maquina_id)
      references public.maquinas (empresa_id, id)
      on delete restrict not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.apontamentos'::regclass
      and conname = 'apontamentos_usuario_novo_check'
  ) then
    alter table public.apontamentos
      add constraint apontamentos_usuario_novo_check
      check (user_id is not null) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.apontamentos'::regclass
      and conname = 'apontamentos_cronometro_ativo_check'
  ) then
    alter table public.apontamentos
      add constraint apontamentos_cronometro_ativo_check
      check (status <> 'em_andamento' or cronometro_inicio is not null) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.apontamento_pausas'::regclass
      and conname = 'apontamento_pausas_apontamento_fkey'
  ) then
    alter table public.apontamento_pausas
      add constraint apontamento_pausas_apontamento_fkey
      foreign key (apontamento_id)
      references public.apontamentos (id)
      on delete restrict not valid;
  end if;
end;
$$;

-- O relacionamento produto -> operacoes nao pode mais apagar o roteiro em
-- cascata. A FK atual e valida e pode ser recriada sem tocar nos registros.
alter table public.operacoes
  drop constraint if exists operacoes_produto_id_fkey;
alter table public.operacoes
  add constraint operacoes_produto_id_fkey
  foreign key (produto_id) references public.produtos(id) on delete restrict;

-- Somente uma operacao ativa por sequencia. Versoes anteriores permanecem
-- inativas e preservam seus UUIDs para ordens e apontamentos historicos.
drop index if exists public.operacoes_empresa_produto_ordem_uidx;
create unique index if not exists operacoes_empresa_produto_ordem_ativo_uidx
  on public.operacoes (empresa_id, produto_id, ordem)
  where ativo;

-- ---------------------------------------------------------------------------
-- Snapshot imutavel do roteiro liberado para cada ordem
-- ---------------------------------------------------------------------------

alter table public.ordens_producao
  add column if not exists produto_id uuid,
  add column if not exists roteiro_versao text;

update public.ordens_producao op
set produto_id = p.id
from public.produtos p
where p.empresa_id = op.empresa_id
  and p.codigo = op.produto_codigo
  and op.produto_id is null;

update public.ordens_producao op
set roteiro_versao = coalesce((
  select max(o.versao)
  from public.operacoes o
  where o.empresa_id = op.empresa_id
    and o.produto_id = op.produto_id
    and o.ativo
), '1.0')
where op.roteiro_versao is null;

alter table public.ordens_producao alter column produto_id set not null;
alter table public.ordens_producao alter column roteiro_versao set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ordens_producao'::regclass
      and conname = 'ordens_producao_produto_empresa_fkey'
  ) then
    alter table public.ordens_producao
      add constraint ordens_producao_produto_empresa_fkey
      foreign key (empresa_id, produto_id)
      references public.produtos (empresa_id, id)
      on delete restrict;
  end if;
end;
$$;

create table if not exists public.ordem_producao_operacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  ordem_id uuid not null references public.ordens_producao(id) on delete cascade,
  produto_id uuid not null references public.produtos(id) on delete restrict,
  operacao_id uuid not null references public.operacoes(id) on delete restrict,
  maquina_id uuid references public.maquinas(id) on delete restrict,
  maquinas_ids uuid[] not null default '{}'::uuid[],
  sequencia integer not null check (sequencia > 0),
  operacao_nome text not null,
  tempo_original numeric not null check (tempo_original >= 0),
  unidade_original text not null,
  tempo_segundos numeric not null check (tempo_segundos >= 0),
  setup_segundos numeric not null default 0 check (setup_segundos >= 0),
  obrigatoria boolean not null default true,
  roteiro_versao text not null,
  origem_snapshot text not null default 'liberacao_ordem',
  created_at timestamptz not null default now(),
  unique (empresa_id, ordem_id, operacao_id),
  unique (empresa_id, ordem_id, sequencia)
);

create index if not exists ordem_producao_operacoes_ordem_idx
  on public.ordem_producao_operacoes (empresa_id, ordem_id, sequencia);
create index if not exists ordem_producao_operacoes_operacao_idx
  on public.ordem_producao_operacoes (empresa_id, operacao_id);

create table if not exists public.ordem_producao_bom_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  ordem_id uuid not null references public.ordens_producao(id) on delete cascade,
  produto_id uuid not null references public.produtos(id) on delete restrict,
  insumo_id uuid not null references public.insumos(id) on delete restrict,
  quantidade_por_unidade numeric not null check (quantidade_por_unidade > 0),
  unidade_medida text not null,
  origem_snapshot text not null default 'liberacao_ordem',
  created_at timestamptz not null default now(),
  unique (empresa_id, ordem_id, insumo_id)
);

create index if not exists ordem_producao_bom_itens_ordem_idx
  on public.ordem_producao_bom_itens (empresa_id, ordem_id, insumo_id);

alter table public.ordem_producao_operacoes enable row level security;
alter table public.ordem_producao_bom_itens enable row level security;

drop policy if exists ordem_producao_operacoes_select_empresa
  on public.ordem_producao_operacoes;
create policy ordem_producao_operacoes_select_empresa
on public.ordem_producao_operacoes
for select to authenticated
using (
  (select public.tem_acesso_empresa(empresa_id))
  or (select public.is_master())
);

drop policy if exists ordem_producao_bom_itens_select_empresa
  on public.ordem_producao_bom_itens;
create policy ordem_producao_bom_itens_select_empresa
on public.ordem_producao_bom_itens
for select to authenticated
using (
  (select public.tem_acesso_empresa(empresa_id))
  or (select public.is_master())
);

revoke all on public.ordem_producao_operacoes from public, anon, authenticated;
grant select on public.ordem_producao_operacoes to authenticated;
revoke all on public.ordem_producao_bom_itens from public, anon, authenticated;
grant select on public.ordem_producao_bom_itens to authenticated;

insert into public.ordem_producao_operacoes (
  empresa_id, ordem_id, produto_id, operacao_id, maquina_id, maquinas_ids, sequencia,
  operacao_nome, tempo_original, unidade_original, tempo_segundos,
  setup_segundos, obrigatoria, roteiro_versao, origem_snapshot
)
select
  op.empresa_id,
  op.id,
  op.produto_id,
  o.id,
  o.maquina_id,
  coalesce((
    select array_agg(postos.maquina_id order by postos.maquina_id)
    from (
      select opt.maquina_id
      from public.operacao_postos_trabalho opt
      where opt.empresa_id = o.empresa_id
        and opt.operacao_id = o.id
        and opt.ativo
      union
      select o.maquina_id where o.maquina_id is not null
    ) postos
  ), '{}'::uuid[]),
  o.ordem,
  o.nome,
  o.tempo,
  o.unidade,
  case lower(o.unidade)
    when 'seconds' then o.tempo
    when 'second' then o.tempo
    when 'segundos' then o.tempo
    when 's' then o.tempo
    when 'hours' then o.tempo * 3600
    when 'hour' then o.tempo * 3600
    when 'h' then o.tempo * 3600
    else o.tempo * 60
  end,
  case lower(o.unidade)
    when 'seconds' then coalesce(o.setup_time, 0)
    when 'second' then coalesce(o.setup_time, 0)
    when 'segundos' then coalesce(o.setup_time, 0)
    when 's' then coalesce(o.setup_time, 0)
    when 'hours' then coalesce(o.setup_time, 0) * 3600
    when 'hour' then coalesce(o.setup_time, 0) * 3600
    when 'h' then coalesce(o.setup_time, 0) * 3600
    else coalesce(o.setup_time, 0) * 60
  end,
  coalesce(o.obrigatoria, true),
  coalesce(op.roteiro_versao, o.versao, '1.0'),
  'auditoria_2026_08_04_roteiro_ativo'
from public.ordens_producao op
join public.operacoes o
  on o.empresa_id = op.empresa_id
 and o.produto_id = op.produto_id
 and o.ativo
on conflict do nothing;

insert into public.ordem_producao_bom_itens (
  empresa_id, ordem_id, produto_id, insumo_id, quantidade_por_unidade,
  unidade_medida, origem_snapshot
)
select
  op.empresa_id,
  op.id,
  op.produto_id,
  b.insumo_id,
  sum(b.quantidade),
  max(b.unidade_medida),
  'auditoria_2026_08_04_bom_atual'
from public.ordens_producao op
join public.bom_itens b
  on b.empresa_id = op.empresa_id
 and b.produto_codigo = op.produto_codigo
group by op.empresa_id, op.id, op.produto_id, b.insumo_id
on conflict do nothing;

create or replace function private.preparar_ordem_producao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_produto public.produtos%rowtype;
  v_versao text;
begin
  select p.* into v_produto
  from public.produtos p
  where p.empresa_id = new.empresa_id
    and p.codigo = new.produto_codigo
    and p.ativo;

  if not found then
    raise exception 'Produto ativo nao encontrado para a ordem de producao'
      using errcode = '23503';
  end if;

  if tg_op = 'UPDATE'
     and (old.empresa_id, old.produto_id, old.produto_codigo)
       is distinct from (new.empresa_id, v_produto.id, new.produto_codigo)
     and exists (
       select 1 from public.ordem_producao_operacoes s
       where s.ordem_id = old.id
     ) then
    raise exception 'O produto de uma ordem com roteiro congelado nao pode ser alterado'
      using errcode = '23514';
  end if;

  select max(o.versao) into v_versao
  from public.operacoes o
  where o.empresa_id = new.empresa_id
    and o.produto_id = v_produto.id
    and o.ativo;

  if v_versao is null then
    raise exception 'O produto nao possui roteiro ativo'
      using errcode = '23514';
  end if;

  new.produto_id := v_produto.id;
  new.roteiro_versao := v_versao;
  return new;
end;
$$;

create or replace function private.criar_snapshot_roteiro_ordem()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inseridas integer;
begin
  insert into public.ordem_producao_operacoes (
    empresa_id, ordem_id, produto_id, operacao_id, maquina_id, maquinas_ids, sequencia,
    operacao_nome, tempo_original, unidade_original, tempo_segundos,
    setup_segundos, obrigatoria, roteiro_versao, origem_snapshot
  )
  select
    new.empresa_id, new.id, new.produto_id, o.id, o.maquina_id,
    coalesce((
      select array_agg(postos.maquina_id order by postos.maquina_id)
      from (
        select opt.maquina_id
        from public.operacao_postos_trabalho opt
        where opt.empresa_id = o.empresa_id
          and opt.operacao_id = o.id
          and opt.ativo
        union
        select o.maquina_id where o.maquina_id is not null
      ) postos
    ), '{}'::uuid[]),
    o.ordem,
    o.nome, o.tempo, o.unidade,
    case lower(o.unidade)
      when 'seconds' then o.tempo
      when 'second' then o.tempo
      when 'segundos' then o.tempo
      when 's' then o.tempo
      when 'hours' then o.tempo * 3600
      when 'hour' then o.tempo * 3600
      when 'h' then o.tempo * 3600
      else o.tempo * 60
    end,
    case lower(o.unidade)
      when 'seconds' then coalesce(o.setup_time, 0)
      when 'second' then coalesce(o.setup_time, 0)
      when 'segundos' then coalesce(o.setup_time, 0)
      when 's' then coalesce(o.setup_time, 0)
      when 'hours' then coalesce(o.setup_time, 0) * 3600
      when 'hour' then coalesce(o.setup_time, 0) * 3600
      when 'h' then coalesce(o.setup_time, 0) * 3600
      else coalesce(o.setup_time, 0) * 60
    end,
    coalesce(o.obrigatoria, true), new.roteiro_versao, 'liberacao_ordem'
  from public.operacoes o
  where o.empresa_id = new.empresa_id
    and o.produto_id = new.produto_id
    and o.ativo
    and o.versao = new.roteiro_versao
  order by o.ordem;

  get diagnostics v_inseridas = row_count;
  if v_inseridas = 0 then
    raise exception 'Nao foi possivel congelar o roteiro da ordem'
      using errcode = '23514';
  end if;

  insert into public.ordem_producao_bom_itens (
    empresa_id, ordem_id, produto_id, insumo_id, quantidade_por_unidade,
    unidade_medida, origem_snapshot
  )
  select
    new.empresa_id,
    new.id,
    new.produto_id,
    b.insumo_id,
    sum(b.quantidade),
    max(b.unidade_medida),
    'liberacao_ordem'
  from public.bom_itens b
  where b.empresa_id = new.empresa_id
    and b.produto_codigo = new.produto_codigo
  group by b.insumo_id;

  return new;
end;
$$;

drop trigger if exists ordens_producao_preparar_roteiro on public.ordens_producao;
create trigger ordens_producao_preparar_roteiro
before insert or update of empresa_id, produto_codigo, produto_id
on public.ordens_producao
for each row execute function private.preparar_ordem_producao();

drop trigger if exists ordens_producao_criar_snapshot on public.ordens_producao;
create trigger ordens_producao_criar_snapshot
after insert on public.ordens_producao
for each row execute function private.criar_snapshot_roteiro_ordem();

revoke all on function private.preparar_ordem_producao(),
  private.criar_snapshot_roteiro_ordem()
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Salvamento transacional e versionado do GBO
-- ---------------------------------------------------------------------------

create or replace function public.salvar_roteiro_produto(
  p_empresa_id uuid,
  p_codigo text,
  p_descricao text,
  p_operacoes jsonb,
  p_bom jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_produto public.produtos%rowtype;
  v_item record;
  v_operacao_id uuid;
  v_maquina_id uuid;
  v_versao_numero integer;
  v_versao text;
  v_quantidade_operacoes integer := 0;
begin
  if v_user_id is null then
    raise exception 'Sessao expirada' using errcode = '28000';
  end if;

  if not (public.tem_acesso_empresa(p_empresa_id) or public.is_master()) then
    raise exception 'Usuario sem acesso a empresa' using errcode = '42501';
  end if;

  if length(trim(coalesce(p_codigo, ''))) = 0
     or length(trim(coalesce(p_descricao, ''))) < 2 then
    raise exception 'Codigo e descricao do produto sao obrigatorios'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_operacoes) <> 'array'
     or jsonb_array_length(p_operacoes) = 0 then
    raise exception 'O roteiro deve conter ao menos uma operacao'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_empresa_id::text || ':roteiro:' || trim(p_codigo), 0)
  );

  insert into public.produtos (empresa_id, codigo, descricao, ativo, user_id)
  values (p_empresa_id, trim(p_codigo), trim(p_descricao), true, v_user_id)
  on conflict (empresa_id, codigo) do update
    set descricao = excluded.descricao,
        ativo = true
  returning * into v_produto;

  select coalesce(max(
    case
      when split_part(o.versao, '.', 1) ~ '^[0-9]+$'
        then split_part(o.versao, '.', 1)::integer
      else 0
    end
  ), 0) + 1
  into v_versao_numero
  from public.operacoes o
  where o.empresa_id = p_empresa_id
    and o.produto_id = v_produto.id;

  if not exists (
    select 1 from public.operacoes o
    where o.empresa_id = p_empresa_id
      and o.produto_id = v_produto.id
  ) then
    v_versao_numero := 1;
  end if;
  v_versao := v_versao_numero::text || '.0';

  update public.operacao_postos_trabalho posto
  set ativo = false
  from public.operacoes o
  where posto.empresa_id = p_empresa_id
    and posto.operacao_id = o.id
    and o.empresa_id = p_empresa_id
    and o.produto_id = v_produto.id
    and o.ativo;

  update public.operacoes
  set ativo = false
  where empresa_id = p_empresa_id
    and produto_id = v_produto.id
    and ativo;

  for v_item in
    select value as item, ordinality
    from jsonb_array_elements(p_operacoes) with ordinality
  loop
    if length(trim(coalesce(v_item.item ->> 'nome', ''))) < 2 then
      raise exception 'Nome de operacao invalido na posicao %', v_item.ordinality
        using errcode = '22023';
    end if;

    if coalesce((v_item.item ->> 'tempo')::numeric, -1) < 0
       or coalesce((v_item.item ->> 'setup_time')::numeric, 0) < 0 then
      raise exception 'Tempo invalido na operacao %', v_item.ordinality
        using errcode = '22023';
    end if;

    v_maquina_id := nullif(v_item.item ->> 'maquina_id', '')::uuid;
    if v_maquina_id is not null and not exists (
      select 1 from public.maquinas m
      where m.id = v_maquina_id
        and m.empresa_id = p_empresa_id
        and m.status = 'ativa'
    ) then
      raise exception 'Maquina invalida na operacao %', v_item.ordinality
        using errcode = '23503';
    end if;

    insert into public.operacoes (
      empresa_id, produto_id, ordem, nome, tempo, unidade, setup_time,
      maquina_id, versao, vigencia, ativo, obrigatoria
    ) values (
      p_empresa_id,
      v_produto.id,
      v_item.ordinality,
      trim(v_item.item ->> 'nome'),
      (v_item.item ->> 'tempo')::numeric,
      case lower(coalesce(v_item.item ->> 'unidade', 'minutes'))
        when 'seconds' then 'seconds'
        when 'second' then 'seconds'
        when 's' then 'seconds'
        else 'minutes'
      end,
      coalesce((v_item.item ->> 'setup_time')::numeric, 0),
      v_maquina_id,
      v_versao,
      current_date,
      true,
      coalesce((v_item.item ->> 'obrigatoria')::boolean, true)
    ) returning id into v_operacao_id;

    if v_maquina_id is not null then
      insert into public.operacao_postos_trabalho (
        empresa_id, operacao_id, maquina_id, ativo
      ) values (
        p_empresa_id, v_operacao_id, v_maquina_id, true
      ) on conflict (empresa_id, operacao_id, maquina_id) do update
        set ativo = true;
    end if;

    v_quantidade_operacoes := v_quantidade_operacoes + 1;
  end loop;

  delete from public.bom_itens
  where empresa_id = p_empresa_id
    and produto_codigo = v_produto.codigo;

  if jsonb_typeof(coalesce(p_bom, '[]'::jsonb)) <> 'array' then
    raise exception 'A lista de insumos do produto e invalida'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_bom, '[]'::jsonb)) b(value)
    left join public.insumos i
      on i.id = nullif(b.value ->> 'insumo_id', '')::uuid
     and i.empresa_id = p_empresa_id
    where i.id is null
       or coalesce((b.value ->> 'quantidade')::numeric, 0) <= 0
  ) then
    raise exception 'O BOM contem insumo inexistente ou quantidade invalida'
      using errcode = '23514';
  end if;

  if jsonb_typeof(coalesce(p_bom, '[]'::jsonb)) = 'array' then
    insert into public.bom_itens (
      empresa_id, produto_codigo, insumo_id, quantidade, unidade_medida
    )
    select
      p_empresa_id,
      v_produto.codigo,
      (b.value ->> 'insumo_id')::uuid,
      (b.value ->> 'quantidade')::numeric,
      coalesce(nullif(b.value ->> 'unidade_medida', ''), 'un')
    from jsonb_array_elements(coalesce(p_bom, '[]'::jsonb)) b(value)
    join public.insumos i
      on i.id = (b.value ->> 'insumo_id')::uuid
     and i.empresa_id = p_empresa_id
    where (b.value ->> 'quantidade')::numeric > 0;
  end if;

  insert into public.audit_logs (
    tenant_id, entity_type, entity_id, action, module, performed_by,
    old_values, new_values, affected_records, metadata
  ) values (
    p_empresa_id,
    'produto',
    v_produto.id,
    'route_version_created',
    'gbo',
    v_user_id,
    '{}'::jsonb,
    jsonb_build_object('roteiro_versao', v_versao),
    jsonb_build_array(jsonb_build_object(
      'tabela', 'operacoes', 'quantidade', v_quantidade_operacoes
    )),
    jsonb_build_object('produto_codigo', v_produto.codigo)
  );

  return jsonb_build_object(
    'success', true,
    'produto_id', v_produto.id,
    'roteiro_versao', v_versao,
    'operacoes', v_quantidade_operacoes
  );
end;
$$;

revoke all on function public.salvar_roteiro_produto(uuid, text, text, jsonb, jsonb)
from public, anon, authenticated;
grant execute on function public.salvar_roteiro_produto(uuid, text, text, jsonb, jsonb)
to authenticated;

-- O estoque passa a consumir o BOM congelado na ordem. Alterar o produto no
-- GBO nao modifica retroativamente os insumos de uma OP ja criada.
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
    raise exception 'Sessao expirada' using errcode = '28000';
  end if;

  if p_empresa_id is null or p_apontamento_id is null or p_ordem_id is null then
    raise exception 'Empresa, apontamento e ordem sao obrigatorios'
      using errcode = '22004';
  end if;

  select a.* into v_apontamento
  from public.apontamentos a
  where a.id = p_apontamento_id
    and a.empresa_id = p_empresa_id
    and a.ordem_id = p_ordem_id
    and a.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Apontamento nao encontrado ou nao pertence ao operador atual'
      using errcode = '42501';
  end if;

  if v_apontamento.status = 'em_andamento' then
    raise exception 'O apontamento ainda nao foi finalizado'
      using errcode = '23514';
  end if;

  if p_pecas_boas <> greatest(
       coalesce(v_apontamento.pecas_produzidas, 0)
         - coalesce(v_apontamento.pecas_refugo, 0),
       0
     ) or p_refugo <> coalesce(v_apontamento.pecas_refugo, 0) then
    raise exception 'As quantidades divergem do apontamento salvo'
      using errcode = '23514';
  end if;

  select op.* into v_ordem
  from public.ordens_producao op
  where op.id = p_ordem_id
    and op.empresa_id = p_empresa_id
    and op.produto_codigo = p_produto_codigo
  for update;

  if not found then
    raise exception 'Ordem de producao e produto nao correspondem'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from public.movimentacoes_estoque m
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
    coalesce(v_ordem.quantidade_aprovada, 0)
      - coalesce(v_ordem.quantidade_aprovada_estoque, 0),
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

  select p.* into v_produto
  from public.produtos p
  where p.id = v_ordem.produto_id
    and p.empresa_id = p_empresa_id
    and p.codigo = p_produto_codigo;

  if not found then
    raise exception 'Produto da ordem nao encontrado' using errcode = '23503';
  end if;

  if not exists (
    select 1 from public.ordem_producao_bom_itens b
    where b.empresa_id = p_empresa_id
      and b.ordem_id = p_ordem_id
  ) then
    return jsonb_build_object(
      'processado', false,
      'idempotente', false,
      'motivo', 'bom_snapshot_ausente',
      'quantidade_creditada', 0,
      'avisos', v_avisos
    );
  end if;

  for v_item in
    select
      b.insumo_id,
      b.quantidade_por_unidade,
      i.codigo,
      i.preco_unitario
    from public.ordem_producao_bom_itens b
    join public.insumos i
      on i.id = b.insumo_id
     and i.empresa_id = b.empresa_id
    where b.empresa_id = p_empresa_id
      and b.ordem_id = p_ordem_id
    order by b.insumo_id
  loop
    v_consumo := v_item.quantidade_por_unidade * v_quantidade_creditar;

    insert into public.saldo_estoque (
      empresa_id, insumo_id, saldo_atual, custo_medio, valor_total, updated_at
    ) values (
      p_empresa_id, v_item.insumo_id, 0,
      coalesce(v_item.preco_unitario, 0), 0, now()
    ) on conflict (empresa_id, insumo_id) do nothing;

    select s.saldo_atual, s.custo_medio
    into v_saldo_anterior, v_custo_medio
    from public.saldo_estoque s
    where s.empresa_id = p_empresa_id
      and s.insumo_id = v_item.insumo_id
    for update;

    v_saldo_posterior := v_saldo_anterior - v_consumo;
    v_custo_produto := v_custo_produto
      + (v_item.quantidade_por_unidade * v_custo_medio);

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
      p_empresa_id, v_item.insumo_id, 'saida', v_consumo,
      v_saldo_anterior, v_saldo_posterior, 'producao', p_apontamento_id,
      p_observacao, v_user_id, v_custo_medio, v_consumo * v_custo_medio
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
  ) on conflict (empresa_id, codigo) do update
    set descricao = excluded.descricao
  returning * into v_insumo_produto;

  if v_insumo_produto.tipo <> 'produto_acabado' then
    raise exception 'O codigo do produto existe no estoque com outro tipo'
      using errcode = '23505';
  end if;

  insert into public.saldo_estoque (
    empresa_id, insumo_id, saldo_atual, custo_medio, valor_total, updated_at
  ) values (
    p_empresa_id, v_insumo_produto.id, 0, v_custo_produto, 0, now()
  ) on conflict (empresa_id, insumo_id) do nothing;

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
      (v_saldo_anterior * v_custo_medio)
        + (v_quantidade_creditar * v_custo_produto)
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
  set quantidade_aprovada_estoque = quantidade_aprovada_estoque
    + v_quantidade_creditar
  where id = p_ordem_id and empresa_id = p_empresa_id;

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

-- ---------------------------------------------------------------------------
-- Inicio explicito, idempotente, com snapshot e evento de auditoria
-- ---------------------------------------------------------------------------

alter table public.production_order_events
  add column if not exists command_id uuid;

create unique index if not exists production_order_events_inicio_unique_idx
  on public.production_order_events (tenant_id, apontamento_id, event_type)
  where event_type = 'production_report_started';

drop function if exists public.iniciar_apontamento_no_posto(
  uuid, uuid, uuid, uuid, boolean, text
);

create function public.iniciar_apontamento_no_posto(
  p_empresa_id uuid,
  p_ordem_id uuid,
  p_operacao_id uuid,
  p_maquina_id uuid,
  p_override boolean,
  p_justificativa text,
  p_command_id uuid
)
returns public.apontamentos
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_operacao public.operacoes%rowtype;
  v_apontamento public.apontamentos%rowtype;
  v_intervalo record;
  v_intervalo_ativo boolean := false;
  v_agora timestamptz := now();
  v_fuso text;
  v_command_id uuid := coalesce(p_command_id, gen_random_uuid());
begin
  if v_user_id is null then
    raise exception 'Sessao expirada' using errcode = '28000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(concat_ws(
    ':', p_empresa_id::text, v_user_id::text, p_ordem_id::text,
    p_operacao_id::text, p_maquina_id::text
  ), 0));

  select a.* into v_apontamento
  from public.apontamentos a
  where a.empresa_id = p_empresa_id
    and a.user_id = v_user_id
    and a.command_id = v_command_id;
  if found then
    return v_apontamento;
  end if;

  select a.* into v_apontamento
  from public.apontamentos a
  where a.empresa_id = p_empresa_id
    and a.user_id = v_user_id
    and a.ordem_id = p_ordem_id
    and a.operacao_id = p_operacao_id
    and a.maquina_id = p_maquina_id
    and a.status = 'em_andamento'
  order by a.created_at
  limit 1;
  if found then
    return v_apontamento;
  end if;

  if not private.pode_acessar_posto_trabalho(p_empresa_id, p_maquina_id) then
    raise exception 'Usuario sem acesso a este posto de trabalho'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.maquinas m
    where m.id = p_maquina_id
      and m.empresa_id = p_empresa_id
      and m.status = 'ativa'
  ) then
    raise exception 'Posto de trabalho indisponivel' using errcode = '23514';
  end if;

  select * into v_intervalo
  from private.intervalo_programado_ativo(
    p_empresa_id, v_user_id, p_maquina_id, v_agora
  )
  limit 1;
  v_intervalo_ativo := found;

  if v_intervalo_ativo then
    if not p_override then
      raise exception 'Nao e possivel iniciar durante o intervalo programado. Retomada as %.',
        to_char(v_intervalo.ends_at at time zone v_intervalo.timezone_name, 'HH24:MI')
        using errcode = 'P0001';
    end if;

    if not private.pode_sobrescrever_intervalo(p_empresa_id, v_user_id) then
      raise exception 'Usuario sem permissao override_scheduled_break'
        using errcode = '42501';
    end if;

    if length(trim(coalesce(p_justificativa, ''))) < 5 then
      raise exception 'Informe uma justificativa para iniciar durante o intervalo'
        using errcode = '22023';
    end if;
  end if;

  select o.* into v_operacao
  from public.ordem_producao_operacoes snapshot
  join public.ordens_producao ordem
    on ordem.id = snapshot.ordem_id
   and ordem.empresa_id = snapshot.empresa_id
  join public.operacoes o
    on o.id = snapshot.operacao_id
   and o.empresa_id = snapshot.empresa_id
  where snapshot.empresa_id = p_empresa_id
    and snapshot.ordem_id = p_ordem_id
    and snapshot.operacao_id = p_operacao_id
    and p_maquina_id = any(snapshot.maquinas_ids)
    and coalesce(ordem.status, '') not in ('encerrada', 'cancelada', 'cancelado');

  if not found then
    raise exception 'A operacao nao pertence ao roteiro congelado e ao posto selecionado'
      using errcode = '42501';
  end if;

  v_fuso := coalesce(private.fuso_empresa(p_empresa_id), 'America/Sao_Paulo');

  insert into public.apontamentos (
    empresa_id, user_id, ordem_id, operacao_id, operacao_nome, maquina_id,
    cronometro_inicio, cronometro_total_segundos, pecas_produzidas,
    pecas_refugo, pecas_retrabalho, status, estado_operacao,
    data_apontamento, hora_inicio, hora_fim, command_id
  ) values (
    p_empresa_id, v_user_id, p_ordem_id, p_operacao_id, v_operacao.nome,
    p_maquina_id, v_agora, 0, 0, 0, 0, 'em_andamento', 'em_execucao',
    (v_agora at time zone v_fuso)::date,
    (v_agora at time zone v_fuso)::time(0),
    (v_agora at time zone v_fuso)::time(0),
    v_command_id
  ) returning * into v_apontamento;

  update public.ordens_producao
  set status = 'em_andamento'
  where id = p_ordem_id and empresa_id = p_empresa_id;

  insert into public.production_order_events (
    tenant_id, production_order_id, operation_id, workstation_id, machine_id,
    operator_id, apontamento_id, event_type, event_category, source,
    started_at, ended_at, duration_seconds, created_by, command_id, metadata
  ) values (
    p_empresa_id, p_ordem_id, p_operacao_id, p_maquina_id, p_maquina_id,
    v_user_id, v_apontamento.id, 'production_report_started', 'production',
    'operator', v_agora, v_agora, 0, v_user_id, v_command_id,
    jsonb_build_object('action', 'explicit_start')
  );

  if v_intervalo_ativo then
    insert into public.production_order_events (
      tenant_id, production_order_id, operation_id, workstation_id, machine_id,
      operator_id, apontamento_id, schedule_break_id, schedule_date,
      event_type, event_category, source, started_at, ended_at, duration_seconds,
      is_scheduled, exclude_from_machine_downtime, created_by, command_id, metadata
    ) values (
      p_empresa_id, p_ordem_id, p_operacao_id, p_maquina_id, p_maquina_id,
      v_user_id, v_apontamento.id, v_intervalo.break_id,
      v_intervalo.occurrence_date, 'scheduled_break_override', 'planned_stop',
      'user_override', v_agora, v_agora, 0, true, true, v_user_id,
      v_command_id,
      jsonb_build_object('action', 'start', 'justification', trim(p_justificativa))
    );
  end if;

  return v_apontamento;
end;
$$;

revoke all on function public.iniciar_apontamento_no_posto(
  uuid, uuid, uuid, uuid, boolean, text, uuid
) from public, anon, authenticated;
grant execute on function public.iniciar_apontamento_no_posto(
  uuid, uuid, uuid, uuid, boolean, text, uuid
) to authenticated;

-- Ponte temporaria para o frontend publicado antes desta migration. A nova
-- assinatura continua sendo a fonte unica da regra e recebe um command_id
-- gerado no servidor quando o cliente legado ainda nao o envia.
create function public.iniciar_apontamento_no_posto(
  p_empresa_id uuid,
  p_ordem_id uuid,
  p_operacao_id uuid,
  p_maquina_id uuid,
  p_override boolean default false,
  p_justificativa text default null
)
returns public.apontamentos
language sql
security invoker
set search_path = pg_catalog, public
as $$
  select *
  from public.iniciar_apontamento_no_posto(
    p_empresa_id,
    p_ordem_id,
    p_operacao_id,
    p_maquina_id,
    p_override,
    p_justificativa,
    gen_random_uuid()
  );
$$;

revoke all on function public.iniciar_apontamento_no_posto(
  uuid, uuid, uuid, uuid, boolean, text
) from public, anon, authenticated;
grant execute on function public.iniciar_apontamento_no_posto(
  uuid, uuid, uuid, uuid, boolean, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- Consolidacao e encerramento baseados no snapshot da ordem
-- ---------------------------------------------------------------------------

create or replace view public.ordem_operacoes_resumo
with (security_invoker = true)
as
select
  op.empresa_id,
  op.id as ordem_id,
  s.operacao_id,
  s.sequencia,
  s.operacao_nome,
  true as ativa,
  s.obrigatoria,
  op.quantidade as quantidade_planejada,
  coalesce(sum(a.pecas_produzidas) filter (
    where a.status not in ('cancelado', 'cancelada', 'estornado')
  ), 0)::integer as quantidade_processada,
  coalesce(sum(greatest(
    coalesce(a.pecas_produzidas, 0) - coalesce(a.pecas_refugo, 0), 0
  )) filter (
    where a.status not in ('cancelado', 'cancelada', 'estornado')
  ), 0)::integer as quantidade_aprovada,
  case
    when not s.obrigatoria then 'opcional'
    when coalesce(bool_or(a.status = 'em_andamento'), false) then 'em_andamento'
    when coalesce(sum(a.pecas_produzidas) filter (
      where a.status not in ('cancelado', 'cancelada', 'estornado')
    ), 0) >= op.quantidade then 'concluida'
    when coalesce(sum(a.pecas_produzidas) filter (
      where a.status not in ('cancelado', 'cancelada', 'estornado')
    ), 0) > 0 then 'parcialmente_concluida'
    else 'pendente'
  end as status_operacao
from public.ordens_producao op
join public.ordem_producao_operacoes s
  on s.empresa_id = op.empresa_id and s.ordem_id = op.id
left join public.apontamentos a
  on a.empresa_id = op.empresa_id
 and a.ordem_id = op.id
 and a.operacao_id = s.operacao_id
group by op.empresa_id, op.id, s.operacao_id, s.sequencia,
  s.operacao_nome, s.obrigatoria, op.quantidade;

revoke all on public.ordem_operacoes_resumo from public, anon;
grant select on public.ordem_operacoes_resumo to authenticated;

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
  v_total_operacoes integer := 0;
  v_operacoes_pendentes integer := 0;
  v_apontamentos_ativos integer := 0;
  v_quantidade_processada integer := 0;
  v_quantidade_aprovada integer := 0;
  v_novo_status text;
  v_tem_apontamento boolean := false;
  v_ultima_finalizacao timestamptz;
begin
  select op.* into v_ordem
  from public.ordens_producao op
  where op.id = p_ordem_id and op.empresa_id = p_empresa_id
  for update;

  if not found then
    raise exception 'Ordem de producao nao encontrada' using errcode = '23503';
  end if;

  with operacoes_obrigatorias as (
    select s.operacao_id
    from public.ordem_producao_operacoes s
    where s.empresa_id = p_empresa_id
      and s.ordem_id = p_ordem_id
      and s.obrigatoria
  ), totais as (
    select
      s.operacao_id,
      coalesce(sum(a.pecas_produzidas) filter (
        where a.status not in ('cancelado', 'cancelada', 'estornado')
      ), 0)::integer as processadas,
      coalesce(sum(greatest(
        coalesce(a.pecas_produzidas, 0) - coalesce(a.pecas_refugo, 0), 0
      )) filter (
        where a.status not in ('cancelado', 'cancelada', 'estornado')
      ), 0)::integer as aprovadas,
      coalesce(bool_or(a.status = 'em_andamento'), false) as possui_ativo
    from operacoes_obrigatorias s
    left join public.apontamentos a
      on a.empresa_id = p_empresa_id
     and a.ordem_id = p_ordem_id
     and a.operacao_id = s.operacao_id
    group by s.operacao_id
  )
  select
    count(*)::integer,
    count(*) filter (
      where processadas < v_ordem.quantidade or possui_ativo
    )::integer,
    coalesce(min(least(processadas, v_ordem.quantidade)), 0)::integer,
    coalesce(min(least(aprovadas, v_ordem.quantidade)), 0)::integer
  into v_total_operacoes, v_operacoes_pendentes,
    v_quantidade_processada, v_quantidade_aprovada
  from totais;

  select count(*)::integer into v_apontamentos_ativos
  from public.apontamentos a
  where a.empresa_id = p_empresa_id
    and a.ordem_id = p_ordem_id
    and a.status = 'em_andamento';

  select exists (
    select 1 from public.apontamentos a
    where a.empresa_id = p_empresa_id
      and a.ordem_id = p_ordem_id
      and a.status not in ('cancelado', 'cancelada', 'estornado')
  ) into v_tem_apontamento;

  select max(coalesce(a.finalizado_em, a.created_at))
  into v_ultima_finalizacao
  from public.apontamentos a
  where a.empresa_id = p_empresa_id
    and a.ordem_id = p_ordem_id
    and a.status not in ('em_andamento', 'cancelado', 'cancelada', 'estornado');

  if v_ordem.status in ('cancelada', 'cancelado') then
    v_novo_status := v_ordem.status;
  elsif v_total_operacoes > 0
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
  where id = p_ordem_id and empresa_id = p_empresa_id;

  if v_ordem.status = 'encerrada' and v_novo_status <> 'encerrada' then
    insert into public.production_order_events (
      tenant_id, production_order_id, event_type, event_category, source,
      started_at, ended_at, duration_seconds, created_by, metadata
    ) values (
      p_empresa_id, p_ordem_id, 'production_order_reopened', 'production',
      'database_rule', now(), now(), 0, auth.uid(),
      jsonb_build_object(
        'motivo', 'recalculo_por_snapshot',
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

create or replace function public.validar_encerramento_ordem_producao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total_operacoes integer;
  v_operacoes_pendentes integer;
  v_apontamentos_ativos integer;
begin
  if new.status is not distinct from old.status
     or new.status is distinct from 'encerrada' then
    return new;
  end if;

  with operacoes_obrigatorias as (
    select s.operacao_id
    from public.ordem_producao_operacoes s
    where s.empresa_id = new.empresa_id
      and s.ordem_id = new.id
      and s.obrigatoria
  ), totais as (
    select
      s.operacao_id,
      coalesce(sum(a.pecas_produzidas) filter (
        where a.status not in ('cancelado', 'cancelada', 'estornado')
      ), 0)::integer as processadas,
      coalesce(bool_or(a.status = 'em_andamento'), false) as possui_ativo
    from operacoes_obrigatorias s
    left join public.apontamentos a
      on a.empresa_id = new.empresa_id
     and a.ordem_id = new.id
     and a.operacao_id = s.operacao_id
    group by s.operacao_id
  )
  select
    count(*)::integer,
    count(*) filter (
      where processadas < new.quantidade or possui_ativo
    )::integer
  into v_total_operacoes, v_operacoes_pendentes
  from totais;

  select count(*)::integer into v_apontamentos_ativos
  from public.apontamentos a
  where a.empresa_id = new.empresa_id
    and a.ordem_id = new.id
    and a.status = 'em_andamento';

  if coalesce(v_total_operacoes, 0) = 0 then
    raise exception 'A OP nao pode ser encerrada sem operacoes obrigatorias no snapshot'
      using errcode = '23514';
  end if;
  if coalesce(v_operacoes_pendentes, 0) > 0 then
    raise exception 'A OP possui % operacao(oes) obrigatoria(s) pendente(s)',
      v_operacoes_pendentes using errcode = '23514';
  end if;
  if coalesce(v_apontamentos_ativos, 0) > 0 then
    raise exception 'A OP possui % apontamento(s) ativo(s)', v_apontamentos_ativos
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.validar_encerramento_ordem_producao()
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Exclusao segura e cancelamento auditado
-- ---------------------------------------------------------------------------

create or replace function private.proteger_exclusao_historica()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'ordens_producao' then
    if old.status not in ('planejada', 'aberta', 'rascunho')
       or exists (select 1 from public.apontamentos a where a.ordem_id = old.id)
       or exists (
         select 1 from public.production_order_events e
         where e.production_order_id = old.id
       ) then
      raise exception 'A ordem possui historico; use cancelamento auditado'
        using errcode = '23503';
    end if;
  elsif tg_table_name = 'operacoes' then
    if exists (
         select 1 from public.ordem_producao_operacoes s
         where s.operacao_id = old.id
       ) or exists (
         select 1 from public.apontamentos a where a.operacao_id = old.id
       ) then
      raise exception 'A operacao possui historico e nao pode ser excluida'
        using errcode = '23503';
    end if;
  elsif tg_table_name = 'produtos' then
    if exists (
         select 1 from public.ordens_producao op where op.produto_id = old.id
       ) or exists (
         select 1 from public.ordem_producao_operacoes s where s.produto_id = old.id
       ) then
      raise exception 'O produto possui historico; use inativacao'
        using errcode = '23503';
    end if;
  elsif tg_table_name = 'maquinas' then
    if exists (
         select 1 from public.apontamentos a where a.maquina_id = old.id
       ) or exists (
         select 1 from public.production_order_events e where e.machine_id = old.id
       ) or exists (
         select 1 from public.ordem_producao_operacoes s
         where s.maquina_id = old.id or old.id = any(s.maquinas_ids)
       ) then
      raise exception 'A maquina possui historico; use inativacao'
        using errcode = '23503';
    end if;
  end if;
  return old;
end;
$$;

drop trigger if exists ordens_producao_proteger_delete on public.ordens_producao;
create trigger ordens_producao_proteger_delete
before delete on public.ordens_producao
for each row execute function private.proteger_exclusao_historica();
drop trigger if exists operacoes_proteger_delete on public.operacoes;
create trigger operacoes_proteger_delete
before delete on public.operacoes
for each row execute function private.proteger_exclusao_historica();
drop trigger if exists produtos_proteger_delete on public.produtos;
create trigger produtos_proteger_delete
before delete on public.produtos
for each row execute function private.proteger_exclusao_historica();
drop trigger if exists maquinas_proteger_delete on public.maquinas;
create trigger maquinas_proteger_delete
before delete on public.maquinas
for each row execute function private.proteger_exclusao_historica();

revoke all on function private.proteger_exclusao_historica()
from public, anon, authenticated;

create or replace function public.cancelar_ou_excluir_ordem_producao(
  p_empresa_id uuid,
  p_ordem_id uuid,
  p_motivo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ordem public.ordens_producao%rowtype;
  v_possui_historico boolean;
begin
  if v_user_id is null then
    raise exception 'Sessao expirada' using errcode = '28000';
  end if;
  if not (public.tem_acesso_empresa(p_empresa_id) or public.is_master()) then
    raise exception 'Usuario sem acesso a empresa' using errcode = '42501';
  end if;

  select op.* into v_ordem
  from public.ordens_producao op
  where op.id = p_ordem_id and op.empresa_id = p_empresa_id
  for update;
  if not found then
    raise exception 'Ordem de producao nao encontrada' using errcode = '23503';
  end if;

  if exists (
    select 1 from public.apontamentos a
    where a.empresa_id = p_empresa_id
      and a.ordem_id = p_ordem_id
      and a.status = 'em_andamento'
  ) then
    raise exception 'Finalize ou estorne os apontamentos ativos antes de cancelar a OP'
      using errcode = '23514';
  end if;

  select
    exists (select 1 from public.apontamentos a where a.ordem_id = p_ordem_id)
    or exists (
      select 1 from public.production_order_events e
      where e.production_order_id = p_ordem_id
    )
  into v_possui_historico;

  if v_ordem.status in ('planejada', 'aberta', 'rascunho')
     and not v_possui_historico then
    delete from public.ordens_producao
    where id = p_ordem_id and empresa_id = p_empresa_id;
    return jsonb_build_object('success', true, 'action', 'deleted_draft');
  end if;

  if length(trim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Informe o motivo do cancelamento'
      using errcode = '22023';
  end if;

  update public.ordens_producao
  set status = 'cancelada', concluida_em = null
  where id = p_ordem_id and empresa_id = p_empresa_id;

  insert into public.production_order_events (
    tenant_id, production_order_id, event_type, event_category, source,
    started_at, ended_at, duration_seconds, created_by, metadata
  ) values (
    p_empresa_id, p_ordem_id, 'production_order_cancelled', 'production',
    'operator', now(), now(), 0, v_user_id,
    jsonb_build_object(
      'motivo', trim(p_motivo),
      'status_anterior', v_ordem.status,
      'status_novo', 'cancelada'
    )
  );

  return jsonb_build_object('success', true, 'action', 'cancelled');
end;
$$;

revoke all on function public.cancelar_ou_excluir_ordem_producao(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.cancelar_ou_excluir_ordem_producao(uuid, uuid, text)
to authenticated;

-- Reduz a superficie sem interromper os INSERT/UPDATE ainda usados por outros
-- cadastros. Escritas criticas passam pelas RPCs acima.
revoke truncate, references, trigger
on public.produtos, public.operacoes, public.maquinas,
  public.ordens_producao, public.apontamentos,
  public.production_order_events, public.movimentacoes_estoque,
  public.audit_logs, public.ordem_producao_operacoes,
  public.ordem_producao_bom_itens
from anon, authenticated;

revoke delete
on public.produtos, public.operacoes, public.maquinas,
  public.ordens_producao, public.apontamentos,
  public.production_order_events, public.movimentacoes_estoque,
  public.audit_logs, public.ordem_producao_operacoes,
  public.ordem_producao_bom_itens
from anon, authenticated;

notify pgrst, 'reload schema';

commit;

-- Rollback seguro (executar somente em migration posterior e apos diagnostico):
-- 1. restaurar a assinatura anterior de iniciar_apontamento_no_posto;
-- 2. restaurar as funcoes de consolidacao da migration 20260803153000;
-- 3. remover os quatro triggers de protecao e os dois triggers de snapshot;
-- 4. restaurar a FK operacoes_produto_id_fkey com a politica desejada;
-- 5. preservar tabelas/colunas de snapshot e command_id para nao perder trilha;
-- 6. restaurar grants somente se o frontend anterior voltar a ser publicado.
