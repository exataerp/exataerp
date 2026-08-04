-- Auditoria somente leitura do fluxo de produção do Exata ERP.
-- Execute com um papel autorizado. O script não corrige, não exclui e não bloqueia dados.
-- Registre data, projeto e commit junto ao resultado exportado.

begin transaction read only;

-- 1. Contexto do banco e ledger de migrações.
select
  current_database() as database_name,
  current_setting('server_version') as postgres_version,
  current_setting('timezone') as database_timezone,
  statement_timestamp() as audited_at;

select version, name, statements
from supabase_migrations.schema_migrations
order by version;

-- 2. Volumetria principal.
select 'empresas' as relation, count(*) as rows from public.empresas
union all select 'produtos', count(*) from public.produtos
union all select 'operacoes', count(*) from public.operacoes
union all select 'maquinas', count(*) from public.maquinas
union all select 'ordens_producao', count(*) from public.ordens_producao
union all select 'apontamentos', count(*) from public.apontamentos
union all select 'apontamento_pausas', count(*) from public.apontamento_pausas
union all select 'production_order_events', count(*) from public.production_order_events
union all select 'movimentacoes_estoque', count(*) from public.movimentacoes_estoque
union all select 'audit_logs', count(*) from public.audit_logs
order by relation;

-- 3. Distribuição dos estados físicos.
select status, estado_operacao, count(*) as rows
from public.apontamentos
group by status, estado_operacao
order by status, estado_operacao;

select status, count(*) as rows
from public.ordens_producao
group by status
order by status;

-- 4. Apontamentos órfãos ou cruzando tenant.
select
  a.id as apontamento_id,
  a.empresa_id,
  a.ordem_id,
  a.operacao_id,
  a.maquina_id,
  a.user_id,
  a.status,
  a.estado_operacao,
  a.cronometro_inicio,
  (op.id is null) as ordem_ausente,
  (o.id is null) as operacao_ausente,
  (m.id is null and a.maquina_id is not null) as maquina_ausente,
  (p.id is null and a.user_id is not null) as perfil_ausente,
  (op.id is not null and op.empresa_id is distinct from a.empresa_id) as ordem_tenant_divergente,
  (o.id is not null and o.empresa_id is distinct from a.empresa_id) as operacao_tenant_divergente,
  (m.id is not null and m.empresa_id is distinct from a.empresa_id) as maquina_tenant_divergente,
  (p.id is not null and p.empresa_id is distinct from a.empresa_id) as perfil_tenant_divergente
from public.apontamentos a
left join public.ordens_producao op on op.id = a.ordem_id
left join public.operacoes o on o.id = a.operacao_id
left join public.maquinas m on m.id = a.maquina_id
left join public.perfis p on p.id = a.user_id
where op.id is null
   or o.id is null
   or (a.maquina_id is not null and m.id is null)
   or (a.user_id is not null and p.id is null)
   or op.empresa_id is distinct from a.empresa_id
   or o.empresa_id is distinct from a.empresa_id
   or (m.id is not null and m.empresa_id is distinct from a.empresa_id)
   or (p.id is not null and p.empresa_id is distinct from a.empresa_id)
order by a.cronometro_inicio nulls last, a.id;

-- 5. Sessões realmente ativas e duplicidade exata.
select
  a.id,
  a.empresa_id,
  a.user_id,
  a.ordem_id,
  a.operacao_id,
  a.maquina_id,
  a.cronometro_inicio,
  statement_timestamp() - a.cronometro_inicio as elapsed
from public.apontamentos a
where a.status = 'em_andamento'
   or a.estado_operacao in (
     'em_execucao',
     'pausada_manual',
     'pausada_intervalo_programado',
     'aguardando_retomada'
   )
order by a.cronometro_inicio;

select
  empresa_id,
  user_id,
  ordem_id,
  operacao_id,
  maquina_id,
  count(*) as active_rows,
  array_agg(id order by cronometro_inicio) as apontamento_ids
from public.apontamentos
where status = 'em_andamento'
group by empresa_id, user_id, ordem_id, operacao_id, maquina_id
having count(*) > 1;

-- 6. Campos obrigatórios ausentes e valores impossíveis.
select
  count(*) filter (where empresa_id is null) as sem_empresa,
  count(*) filter (where user_id is null) as sem_usuario,
  count(*) filter (where operacao_id is null) as sem_operacao,
  count(*) filter (where maquina_id is null) as sem_maquina,
  count(*) filter (where pecas_produzidas < 0) as quantidade_negativa,
  count(*) filter (where pecas_refugo < 0) as refugo_negativo,
  count(*) filter (
    where estado_operacao = 'finalizada' and finalizado_em is null
  ) as finalizado_sem_timestamp,
  count(*) filter (
    where status = 'em_andamento' and cronometro_inicio is null
  ) as ativo_sem_cronometro
from public.apontamentos;

-- 7. Ordem, produto e roteiro.
select
  op.id as ordem_id,
  op.empresa_id,
  op.produto_codigo,
  op.status,
  (p.id is null) as produto_ausente,
  (p.id is not null and p.empresa_id is distinct from op.empresa_id) as produto_tenant_divergente,
  count(o.id) filter (where o.ativo) as operacoes_ativas_atuais
from public.ordens_producao op
left join public.produtos p
  on p.empresa_id = op.empresa_id
 and p.codigo = op.produto_codigo
left join public.operacoes o
  on o.produto_id = p.id
 and o.empresa_id = op.empresa_id
group by op.id, op.empresa_id, op.produto_codigo, op.status, p.id, p.empresa_id
having p.id is null
    or p.empresa_id is distinct from op.empresa_id
    or count(o.id) filter (where o.ativo) = 0
order by op.id;

-- Operações com sequência duplicada dentro do roteiro ativo.
select empresa_id, produto_id, ordem, count(*) as rows, array_agg(id) as operacao_ids
from public.operacoes
where ativo
group by empresa_id, produto_id, ordem
having count(*) > 1;

-- 8. Apontamento cuja operação atual não pertence ao produto atual da ordem.
select
  a.id as apontamento_id,
  a.ordem_id,
  a.operacao_id,
  op.produto_codigo,
  produto_ordem.id as produto_ordem_id,
  o.produto_id as produto_operacao_id
from public.apontamentos a
join public.ordens_producao op on op.id = a.ordem_id
join public.operacoes o on o.id = a.operacao_id
left join public.produtos produto_ordem
  on produto_ordem.empresa_id = op.empresa_id
 and produto_ordem.codigo = op.produto_codigo
where produto_ordem.id is distinct from o.produto_id
   or a.empresa_id is distinct from op.empresa_id
   or a.empresa_id is distinct from o.empresa_id;

-- 9. Pausas inválidas, órfãs, negativas ou sobrepostas.
select p.*
from public.apontamento_pausas p
left join public.apontamentos a on a.id = p.apontamento_id
where a.id is null
   or (a.id is not null and a.empresa_id is distinct from p.empresa_id)
   or (p.fim is not null and p.fim < p.inicio);

select
  p1.apontamento_id,
  p1.id as pausa_1,
  p2.id as pausa_2,
  tstzrange(p1.inicio, coalesce(p1.fim, 'infinity'::timestamptz), '[)')
    && tstzrange(p2.inicio, coalesce(p2.fim, 'infinity'::timestamptz), '[)') as sobrepoe
from public.apontamento_pausas p1
join public.apontamento_pausas p2
  on p2.apontamento_id = p1.apontamento_id
 and p2.id > p1.id
where tstzrange(p1.inicio, coalesce(p1.fim, 'infinity'::timestamptz), '[)')
   && tstzrange(p2.inicio, coalesce(p2.fim, 'infinity'::timestamptz), '[)');

-- 10. Movimentos de produção sem cadeia íntegra.
select
  me.id as movimento_id,
  me.empresa_id,
  me.referencia_id as apontamento_id,
  a.ordem_id,
  (a.id is null) as apontamento_ausente,
  (op.id is null and a.id is not null) as ordem_ausente,
  (a.id is not null and a.empresa_id is distinct from me.empresa_id) as apontamento_tenant_divergente,
  (op.id is not null and op.empresa_id is distinct from me.empresa_id) as ordem_tenant_divergente
from public.movimentacoes_estoque me
left join public.apontamentos a on a.id = me.referencia_id
left join public.ordens_producao op on op.id = a.ordem_id
where me.origem = 'producao'
  and (
       a.id is null
   or (a.id is not null and op.id is null)
   or (a.id is not null and a.empresa_id is distinct from me.empresa_id)
   or (op.id is not null and op.empresa_id is distinct from me.empresa_id)
  );

-- Possíveis duplicidades de idempotência na produção.
select
  empresa_id,
  referencia_id as apontamento_id,
  tipo,
  insumo_id,
  count(*) as rows,
  array_agg(id order by created_at) as movimento_ids
from public.movimentacoes_estoque
where origem = 'producao'
  and referencia_id is not null
  and reverses_movement_id is null
group by empresa_id, referencia_id, tipo, insumo_id
having count(*) > 1;

-- 11. Eventos órfãos ou sem ator/origem útil.
select e.*
from public.production_order_events e
left join public.ordens_producao op on op.id = e.production_order_id
where op.id is null
   or op.empresa_id is distinct from e.tenant_id
   or e.event_type is null;

-- 12. Tabelas na publicação Realtime.
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by schemaname, tablename;

-- 13. RLS e tabelas sem políticas.
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  count(p.policyname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p
  on p.schemaname = n.nspname
 and p.tablename = c.relname
where n.nspname = 'public'
  and c.relkind = 'r'
group by n.nspname, c.relname, c.relrowsecurity
order by c.relname;

-- 14. Privilégios amplos concedidos aos papéis da API.
select grantee, table_schema, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
  and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
order by grantee, table_name, privilege_type;

select
  n.nspname as routine_schema,
  p.proname as routine_name,
  case when p.prosecdef then 'DEFINER' else 'INVOKER' end as security_type,
  has_function_privilege(
    'authenticated',
    p.oid,
    'EXECUTE'
  ) as authenticated_can_execute,
  has_function_privilege(
    'anon',
    p.oid,
    'EXECUTE'
  ) as anon_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private')
order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid);

-- 15. Chaves estrangeiras sem índice iniciando pelas mesmas colunas.
with foreign_keys as (
  select
    c.oid as constraint_oid,
    c.conrelid,
    c.conname,
    c.conkey
  from pg_constraint c
  where c.contype = 'f'
), indexed as (
  select i.indrelid, i.indkey::smallint[] as indkey
  from pg_index i
  where i.indisvalid and i.indisready
)
select
  fk.conrelid::regclass as table_name,
  fk.conname as constraint_name,
  pg_get_constraintdef(fk.constraint_oid) as definition
from foreign_keys fk
where not exists (
  select 1
  from indexed i
  where i.indrelid = fk.conrelid
    and array(
      select i.indkey[s]
      from generate_series(0, cardinality(fk.conkey) - 1) as s
    ) = fk.conkey
)
order by fk.conrelid::regclass::text, fk.conname;

-- 16. Evidência dirigida do incidente citado.
select
  a.*,
  op.id as ordem_encontrada,
  o.id as operacao_encontrada,
  m.nome as maquina_nome,
  p.nome as usuario_nome
from public.apontamentos a
left join public.ordens_producao op on op.id = a.ordem_id
left join public.operacoes o on o.id = a.operacao_id
left join public.maquinas m on m.id = a.maquina_id
left join public.perfis p on p.id = a.user_id
where a.id = '17ce8a3f-5663-4a6d-8295-75f9519d4511'::uuid;

rollback;
