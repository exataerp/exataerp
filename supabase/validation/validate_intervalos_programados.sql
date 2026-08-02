-- Validação estrutural e operacional da automação de intervalos programados.
-- Executar após 20260802210000_intervalos_programados_op.sql.

begin;

do $$
declare
  v_definition text;
  v_cron_count integer := 0;
begin
  if to_regclass('public.work_schedule_breaks') is null then
    raise exception '1/15: tabela work_schedule_breaks ausente';
  end if;

  if to_regclass('public.production_order_events') is null then
    raise exception '2/15: tabela production_order_events ausente';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'turnos'
      and column_name = 'pausar_ops_intervalos' and column_default ilike '%true%'
  ) then
    raise exception '3/15: parâmetro automático do turno ausente ou sem default true';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'apontamentos'
      and column_name = 'estado_operacao'
  ) then
    raise exception '4/15: estado_operacao ausente';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'production_order_events_scheduled_unique_idx'
      and indexdef ilike '%schedule_break_id%'
      and indexdef ilike '%schedule_date%'
  ) then
    raise exception '5/15: proteção idempotente da ocorrência ausente';
  end if;

  select pg_get_functiondef('public.processar_intervalos_programados(timestamptz)'::regprocedure)
    into v_definition;
  if v_definition not ilike '%for update%' or v_definition not ilike '%pg_try_advisory_xact_lock%' then
    raise exception '6/15: processador não contém travas de concorrência';
  end if;

  if v_definition not ilike '%estado_operacao = ''em_execucao''%'
     or v_definition not ilike '%status = ''em_andamento''%' then
    raise exception '7/15: filtro de OP ativa/execução ausente';
  end if;

  if v_definition not ilike '%''scheduled_break''%'
     or v_definition not ilike '%''planned_stop''%'
     or v_definition not ilike '%''system''%' then
    raise exception '8/15: classificação do evento programado incompleta';
  end if;

  if v_definition not ilike '%exclude_from_machine_downtime%'
     or v_definition not ilike '%true, true%' then
    raise exception '9/15: exclusão explícita de downtime ausente';
  end if;

  if v_definition not ilike '%aguardando_retomada%'
     or v_definition ilike '%cronometro_inicio = v_item.scheduled_end_at%' then
    raise exception '10/15: fim do intervalo pode estar reiniciando automaticamente';
  end if;

  select pg_get_functiondef('public.iniciar_apontamento_no_posto(uuid,uuid,uuid,uuid,boolean,text)'::regprocedure)
    into v_definition;
  if v_definition not ilike '%Não é possível iniciar esta operação durante o intervalo programado%'
     or v_definition not ilike '%override_scheduled_break%' then
    raise exception '11/15: bloqueio/override de início ausente';
  end if;

  select pg_get_functiondef('public.retomar_apontamento(uuid,uuid,boolean,text)'::regprocedure)
    into v_definition;
  if v_definition not ilike '%justificativa%'
     or v_definition not ilike '%scheduled_break_override%' then
    raise exception '12/15: retomada antecipada sem auditoria completa';
  end if;

  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('work_schedule_breaks', 'production_order_events')
      and c.relrowsecurity
    group by n.nspname
    having count(*) = 2
  ) then
    raise exception '13/15: RLS não está ativo nas tabelas novas';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('work_schedule_breaks', 'production_order_events')
      and grantee = 'anon'
  ) then
    raise exception '14/15: usuário anônimo recebeu acesso indevido';
  end if;

  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception '15/15: pg_cron não está instalado; a pausa não funcionará com a tela fechada';
  end if;

  execute $sql$
    select count(*)
    from cron.job
    where jobname = 'exata-processar-intervalos-programados'
      and schedule = '* * * * *'
      and active
  $sql$ into v_cron_count;

  if v_cron_count <> 1 then
    raise exception '15/15: job recorrente ausente, duplicado ou inativo';
  end if;

  raise notice 'Validação concluída: 15/15 regras estruturais e operacionais aprovadas.';
end;
$$;

rollback;
