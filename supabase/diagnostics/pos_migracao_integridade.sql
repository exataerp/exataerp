-- Verificação somente leitura para executar depois da migration de integridade.
begin transaction read only;

-- Toda ordem deve possuir ao menos uma operação no snapshot.
select op.id, op.empresa_id, op.numero_op, op.produto_codigo, op.roteiro_versao
from public.ordens_producao op
left join public.ordem_producao_operacoes s
  on s.empresa_id = op.empresa_id and s.ordem_id = op.id
group by op.id
having count(s.id) = 0;

-- Apontamentos novos/válidos devem referenciar uma operação do snapshot da OP.
select a.id, a.empresa_id, a.ordem_id, a.operacao_id, a.created_at
from public.apontamentos a
left join public.ordem_producao_operacoes s
  on s.empresa_id = a.empresa_id
 and s.ordem_id = a.ordem_id
 and s.operacao_id = a.operacao_id
where s.id is null
order by a.created_at;

-- Contextos ativos duplicados devem permanecer zerados.
select empresa_id, user_id, ordem_id, operacao_id, maquina_id, count(*)
from public.apontamentos
where status = 'em_andamento'
group by empresa_id, user_id, ordem_id, operacao_id, maquina_id
having count(*) > 1;

-- Comandos repetidos devem permanecer zerados.
select empresa_id, command_id, count(*)
from public.apontamentos
where command_id is not null
group by empresa_id, command_id
having count(*) > 1;

-- Todo início novo deve ter evento de origem operador.
select a.id, a.command_id, a.created_at
from public.apontamentos a
left join public.production_order_events e
  on e.tenant_id = a.empresa_id
 and e.apontamento_id = a.id
 and e.event_type = 'production_report_started'
where a.command_id is not null
  and (e.id is null or e.source <> 'operator');

-- Ordem com BOM mestre deve ter BOM congelado.
select op.id, op.empresa_id, op.produto_codigo
from public.ordens_producao op
where exists (
  select 1 from public.bom_itens b
  where b.empresa_id = op.empresa_id
    and b.produto_codigo = op.produto_codigo
)
and not exists (
  select 1 from public.ordem_producao_bom_itens s
  where s.empresa_id = op.empresa_id
    and s.ordem_id = op.id
);

-- Estado de validação das constraints legadas. As FKs NOT VALID só devem ser
-- validadas em migration posterior quando as consultas de exceção zerarem.
select
  c.conrelid::regclass as table_name,
  c.conname,
  c.contype,
  c.convalidated
from pg_constraint c
where c.conname in (
  'apontamentos_ordem_empresa_fkey',
  'apontamentos_operacao_empresa_fkey',
  'apontamentos_maquina_empresa_fkey',
  'apontamentos_usuario_novo_check',
  'apontamentos_cronometro_ativo_check',
  'apontamento_pausas_apontamento_fkey'
)
order by c.conrelid::regclass::text, c.conname;

rollback;
