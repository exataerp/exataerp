-- Garante a pausa de um apontamento do operador enquanto a tela está aberta.
-- O pg_cron permanece responsável pela automação sem navegador, mas esta RPC
-- autenticada elimina a dependência exclusiva do job executado a cada minuto.

begin;

-- Um posto pode estar cadastrado com um turno padrão e ser utilizado em outro
-- horário. Se esse turno não estiver vigente, continua procurando a jornada da
-- equipe, do operador ou o turno ativo, em vez de abandonar a automação.
create or replace function private.turno_aplicavel_apontamento(
  p_empresa_id uuid,
  p_user_id uuid,
  p_maquina_id uuid,
  p_momento timestamptz
)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_turno_id uuid;
begin
  select m.turno_id into v_turno_id
  from public.maquinas m
  where m.id = p_maquina_id
    and m.empresa_id = p_empresa_id
    and m.turno_id is not null
    and private.data_jornada_turno(m.turno_id, p_momento) is not null;

  if v_turno_id is not null then return v_turno_id; end if;

  select e.turno_id into v_turno_id
  from public.equipes e
  join public.equipe_membros em
    on em.empresa_id = e.empresa_id and em.equipe_id = e.id
  join public.equipe_postos_trabalho ep
    on ep.empresa_id = e.empresa_id and ep.equipe_id = e.id
  where e.empresa_id = p_empresa_id
    and e.ativo
    and e.turno_id is not null
    and em.user_id = p_user_id
    and ep.maquina_id = p_maquina_id
    and private.data_jornada_turno(e.turno_id, p_momento) is not null
  order by e.created_at, e.id
  limit 1;

  if v_turno_id is not null then return v_turno_id; end if;

  select f.turno_id into v_turno_id
  from public.funcionarios f
  where f.empresa_id = p_empresa_id
    and f.user_id = p_user_id
    and f.status = 'ativo'
    and f.turno_id is not null
    and private.data_jornada_turno(f.turno_id, p_momento) is not null
  order by f.created_at, f.id
  limit 1;

  if v_turno_id is not null then return v_turno_id; end if;

  select t.id into v_turno_id
  from public.turnos t
  where t.empresa_id = p_empresa_id
    and t.ativo
    and private.data_jornada_turno(t.id, p_momento) is not null
  order by t.hora_inicio::time, t.id
  limit 1;

  return v_turno_id;
end;
$$;

create or replace function public.sincronizar_intervalo_programado_apontamento(
  p_empresa_id uuid,
  p_apontamento_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_agora timestamptz := clock_timestamp();
  v_apontamento public.apontamentos%rowtype;
  v_intervalo record;
  v_evento public.production_order_events%rowtype;
  v_evento_id uuid;
  v_subgrupo_id uuid;
  v_total_segundos integer;
begin
  if v_user_id is null then
    raise exception 'Sessão expirada' using errcode = '28000';
  end if;

  -- Serializa a sincronização por apontamento sem bloquear outros operadores.
  if not pg_try_advisory_xact_lock(
    hashtextextended('exata:scheduled-break:' || p_apontamento_id::text, 0)
  ) then
    return jsonb_build_object('alterado', false, 'motivo', 'concorrente');
  end if;

  select a.* into v_apontamento
  from public.apontamentos a
  where a.id = p_apontamento_id
    and a.empresa_id = p_empresa_id
    and a.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Apontamento não encontrado' using errcode = '42501';
  end if;

  if v_apontamento.status <> 'em_andamento' then
    return jsonb_build_object(
      'alterado', false,
      'estado', v_apontamento.estado_operacao
    );
  end if;

  -- Ao terminar o intervalo, apenas libera a retomada. O cronômetro não volta
  -- a contar até a confirmação explícita do operador.
  if v_apontamento.estado_operacao = 'pausada_intervalo_programado'
     and v_apontamento.intervalo_programado_evento_id is not null then
    select e.* into v_evento
    from public.production_order_events e
    where e.id = v_apontamento.intervalo_programado_evento_id
      and e.tenant_id = p_empresa_id
      and e.apontamento_id = p_apontamento_id
      and e.event_type = 'scheduled_break'
    for update;

    if found and v_evento.scheduled_end_at <= v_agora then
      update public.production_order_events
      set ended_at = coalesce(ended_at, v_evento.scheduled_end_at),
          duration_seconds = coalesce(
            duration_seconds,
            greatest(extract(epoch from (v_evento.scheduled_end_at - v_evento.started_at))::integer, 0)
          )
      where id = v_evento.id;

      update public.apontamento_pausas
      set fim = coalesce(fim, v_evento.scheduled_end_at)
      where scheduled_event_id = v_evento.id;

      update public.apontamentos
      set estado_operacao = 'aguardando_retomada'
      where id = p_apontamento_id
        and estado_operacao = 'pausada_intervalo_programado'
        and intervalo_programado_evento_id = v_evento.id;

      return jsonb_build_object(
        'alterado', true,
        'estado', 'aguardando_retomada',
        'total_segundos', v_apontamento.cronometro_total_segundos
      );
    end if;

    return jsonb_build_object(
      'alterado', false,
      'estado', v_apontamento.estado_operacao
    );
  end if;

  if v_apontamento.estado_operacao <> 'em_execucao'
     or v_apontamento.cronometro_inicio is null then
    return jsonb_build_object(
      'alterado', false,
      'estado', v_apontamento.estado_operacao
    );
  end if;

  select * into v_intervalo
  from private.intervalo_programado_ativo(
    p_empresa_id,
    v_apontamento.user_id,
    v_apontamento.maquina_id,
    v_agora
  )
  limit 1;

  if not found then
    return jsonb_build_object('alterado', false, 'estado', 'em_execucao');
  end if;

  -- Respeita o início autorizado durante este mesmo intervalo.
  if exists (
    select 1
    from public.production_order_events oe
    where oe.tenant_id = p_empresa_id
      and oe.apontamento_id = p_apontamento_id
      and oe.schedule_break_id = v_intervalo.break_id
      and oe.schedule_date = v_intervalo.occurrence_date
      and oe.event_type = 'scheduled_break_override'
      and oe.metadata ->> 'action' = 'start'
  ) then
    return jsonb_build_object('alterado', false, 'estado', 'em_execucao');
  end if;

  insert into public.production_order_events (
    tenant_id, production_order_id, operation_id, workstation_id, machine_id,
    operator_id, apontamento_id, schedule_break_id, schedule_date,
    event_type, event_category, source, started_at, scheduled_end_at,
    is_scheduled, exclude_from_machine_downtime, metadata
  ) values (
    p_empresa_id, v_apontamento.ordem_id,
    v_apontamento.operacao_id, v_apontamento.maquina_id, v_apontamento.maquina_id,
    v_apontamento.user_id, v_apontamento.id, v_intervalo.break_id, v_intervalo.occurrence_date,
    'scheduled_break', 'planned_stop', 'system', v_intervalo.starts_at, v_intervalo.ends_at,
    true, true,
    jsonb_build_object(
      'break_name', v_intervalo.break_name,
      'schedule_id', v_intervalo.schedule_id,
      'timezone', v_intervalo.timezone_name,
      'processed_at', v_agora,
      'trigger', 'operator_screen',
      'scheduled_duration_seconds', greatest(
        extract(epoch from (v_intervalo.ends_at - v_intervalo.starts_at))::integer,
        0
      )
    )
  )
  on conflict do nothing
  returning id into v_evento_id;

  -- Se o cron já registrou esta ocorrência, ele também atualizou o apontamento
  -- na mesma transação. Não tenta reaplicar uma pausa após override de retomada.
  if v_evento_id is null then
    return jsonb_build_object('alterado', false, 'estado', v_apontamento.estado_operacao);
  end if;

  v_total_segundos := coalesce(v_apontamento.cronometro_total_segundos, 0)
    + greatest(
        extract(epoch from (v_intervalo.starts_at - v_apontamento.cronometro_inicio))::integer,
        0
      );

  update public.apontamentos
  set cronometro_total_segundos = v_total_segundos,
      cronometro_inicio = null,
      estado_operacao = 'pausada_intervalo_programado',
      intervalo_programado_evento_id = v_evento_id
  where id = p_apontamento_id;

  v_subgrupo_id := private.motivo_intervalo_programado(p_empresa_id);

  insert into public.apontamento_pausas (
    empresa_id, apontamento_id, subgrupo_id, inicio,
    event_type, event_category, source, is_scheduled,
    exclude_from_machine_downtime, scheduled_event_id, metadata
  ) values (
    p_empresa_id, p_apontamento_id, v_subgrupo_id, v_intervalo.starts_at,
    'scheduled_break', 'planned_stop', 'system', true, true, v_evento_id,
    jsonb_build_object(
      'break_name', v_intervalo.break_name,
      'scheduled_end_at', v_intervalo.ends_at,
      'trigger', 'operator_screen'
    )
  );

  return jsonb_build_object(
    'alterado', true,
    'estado', 'pausada_intervalo_programado',
    'total_segundos', v_total_segundos,
    'intervalo_inicio', v_intervalo.starts_at,
    'intervalo_fim', v_intervalo.ends_at,
    'intervalo_nome', v_intervalo.break_name
  );
end;
$$;

revoke all on function public.sincronizar_intervalo_programado_apontamento(uuid, uuid)
  from public, anon;
grant execute on function public.sincronizar_intervalo_programado_apontamento(uuid, uuid)
  to authenticated, service_role;

-- Recria explicitamente o job depois das correções de tipo da migração
-- 20260802223000 e executa uma sincronização imediata no momento do deploy.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'exata-processar-intervalos-programados') then
      perform cron.unschedule('exata-processar-intervalos-programados');
    end if;

    perform cron.schedule(
      'exata-processar-intervalos-programados',
      '* * * * *',
      'select public.processar_intervalos_programados();'
    );
  end if;
end;
$$;

select public.processar_intervalos_programados();

notify pgrst, 'reload schema';

commit;
