begin;

-- Apontamentos finalizados antes da migration transacional de 03/08/2026
-- nao possuem finalizado_em/finalizado_por. O fluxo de auditoria interpretava
-- essa ausencia de metadados como falta de rastreabilidade e desabilitava o
-- estorno, inclusive em operacoes intermediarias que legitimamente nao
-- movimentam estoque.
--
-- A data estimada usa o ultimo timestamp conhecido do proprio registro. Nenhum
-- saldo e alterado aqui. Durante o estorno, somente movimentacoes de estoque
-- explicitamente vinculadas ao apontamento sao compensadas.
with candidatos as materialized (
  select
    a.id,
    coalesce(a.updated_at, a.created_at, now()) as finalizado_em_estimado,
    coalesce(a.finalizado_por, a.user_id) as finalizado_por_estimado
  from public.apontamentos a
  where a.finalizado_em is null
    and a.estornado_em is null
    and a.status not in ('em_andamento', 'cancelado', 'cancelada')
    and a.ordem_id is not null
    and a.operacao_id is not null
    and (
      coalesce(a.pecas_produzidas, 0) > 0
      or coalesce(a.pecas_refugo, 0) > 0
      or coalesce(a.pecas_retrabalho, 0) > 0
      or coalesce(a.cronometro_total_segundos, 0) > 0
      or a.hora_fim is not null
    )
), atualizados as (
  update public.apontamentos a
  set finalizado_em = c.finalizado_em_estimado,
      finalizado_por = c.finalizado_por_estimado
  from candidatos c
  where a.id = c.id
  returning
    a.id,
    a.empresa_id,
    a.finalizado_em,
    a.finalizado_por
)
insert into public.audit_logs (
  tenant_id,
  entity_type,
  entity_id,
  action,
  module,
  original_record_id,
  performed_by,
  old_values,
  new_values,
  metadata
)
select
  u.empresa_id,
  'apontamento_producao',
  u.id,
  'legacy_metadata_backfilled',
  'producao',
  u.id,
  u.finalizado_por,
  jsonb_build_object(
    'finalizado_em', null,
    'finalizado_por', null
  ),
  jsonb_build_object(
    'finalizado_em', u.finalizado_em,
    'finalizado_por', u.finalizado_por
  ),
  jsonb_build_object(
    'migration', '20260803190000_libera_estorno_apontamentos_legados',
    'stock_policy', 'reverter_somente_movimentacoes_explicitamente_vinculadas'
  )
from atualizados u;

notify pgrst, 'reload schema';

commit;

-- Reversao operacional:
-- 1. nao apagar os audit_logs gerados, pois o historico e imutavel;
-- 2. se indispensavel, limpar finalizado_em/finalizado_por somente nos IDs
--    identificados pelo metadata desta migration e antes de qualquer estorno.
