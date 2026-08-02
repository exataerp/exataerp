-- Corrige comparações entre turnos.hora_inicio/hora_fim (text) e valores time.
-- O cast explícito evita "operator does not exist: time without time zone >= text".

begin;

create or replace function private.data_jornada_turno(
  p_turno_id uuid,
  p_momento timestamptz
)
returns date
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_turno public.turnos%rowtype;
  v_local timestamp;
  v_data_jornada date;
  v_fuso text;
  v_dia_excecao boolean;
  v_hora_inicio time;
  v_hora_fim time;
begin
  select t.* into v_turno
  from public.turnos t
  where t.id = p_turno_id and t.ativo;

  if not found then return null; end if;

  v_hora_inicio := v_turno.hora_inicio::time;
  v_hora_fim := v_turno.hora_fim::time;
  v_fuso := coalesce(private.fuso_empresa(v_turno.empresa_id), 'America/Sao_Paulo');
  v_local := p_momento at time zone v_fuso;

  if v_hora_fim > v_hora_inicio then
    if v_local::time >= v_hora_inicio and v_local::time < v_hora_fim then
      v_data_jornada := v_local::date;
    else
      return null;
    end if;
  else
    if v_local::time >= v_hora_inicio then
      v_data_jornada := v_local::date;
    elsif v_local::time < v_hora_fim then
      v_data_jornada := v_local::date - 1;
    else
      return null;
    end if;
  end if;

  select x.is_working_day into v_dia_excecao
  from public.work_schedule_exceptions x
  where x.tenant_id = v_turno.empresa_id
    and x.exception_date = v_data_jornada
    and (x.schedule_id is null or x.schedule_id = v_turno.id)
  order by (x.schedule_id = v_turno.id) desc, x.created_at desc
  limit 1;

  if found then
    if not v_dia_excecao then return null; end if;
  elsif not (extract(dow from v_data_jornada)::integer::text = any(v_turno.dias_semana)) then
    return null;
  end if;

  return v_data_jornada;
end;
$$;

create or replace function private.intervalo_programado_ativo(
  p_empresa_id uuid,
  p_user_id uuid,
  p_maquina_id uuid,
  p_momento timestamptz
)
returns table (
  break_id uuid,
  schedule_id uuid,
  break_name text,
  occurrence_date date,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone_name text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_turno public.turnos%rowtype;
  v_data_jornada date;
  v_fuso text;
  v_break public.work_schedule_breaks%rowtype;
  v_inicio_local timestamp;
  v_fim_local timestamp;
  v_hora_inicio time;
  v_hora_fim time;
begin
  select t.* into v_turno
  from public.turnos t
  where t.id = private.turno_aplicavel_apontamento(
    p_empresa_id, p_user_id, p_maquina_id, p_momento
  );

  if not found or not v_turno.pausar_ops_intervalos then return; end if;

  v_hora_inicio := v_turno.hora_inicio::time;
  v_hora_fim := v_turno.hora_fim::time;
  v_data_jornada := private.data_jornada_turno(v_turno.id, p_momento);
  if v_data_jornada is null then return; end if;
  v_fuso := coalesce(private.fuso_empresa(p_empresa_id), 'America/Sao_Paulo');

  for v_break in
    select b.*
    from public.work_schedule_breaks b
    where b.tenant_id = p_empresa_id
      and b.schedule_id = v_turno.id
      and b.is_active
      and b.pause_operations_automatically
      and extract(dow from v_data_jornada)::integer::text = any(b.days_of_week)
    order by b.execution_order, b.start_time, b.id
  loop
    v_inicio_local := v_data_jornada::timestamp + v_break.start_time;

    -- Em jornadas noturnas, horários menores que o início pertencem ao dia seguinte.
    if v_hora_fim <= v_hora_inicio
       and v_break.start_time < v_hora_inicio then
      v_inicio_local := v_inicio_local + interval '1 day';
    end if;

    v_fim_local := date_trunc('day', v_inicio_local) + v_break.end_time;
    if v_break.end_time <= v_break.start_time then
      v_fim_local := v_fim_local + interval '1 day';
    end if;

    if p_momento >= (v_inicio_local at time zone v_fuso)
       and p_momento < (v_fim_local at time zone v_fuso) then
      break_id := v_break.id;
      schedule_id := v_turno.id;
      break_name := v_break.name;
      occurrence_date := v_data_jornada;
      starts_at := v_inicio_local at time zone v_fuso;
      ends_at := v_fim_local at time zone v_fuso;
      timezone_name := v_fuso;
      return next;
    end if;
  end loop;
end;
$$;

-- Executa as comparações para todos os turnos ativos antes de concluir a migração.
do $$
declare
  v_turno record;
  v_momento_teste timestamptz;
begin
  for v_turno in
    select id, empresa_id, hora_inicio
    from public.turnos
    where ativo
  loop
    v_momento_teste := (
      current_date::timestamp + v_turno.hora_inicio::time + interval '1 minute'
    ) at time zone coalesce(private.fuso_empresa(v_turno.empresa_id), 'America/Sao_Paulo');

    perform private.data_jornada_turno(v_turno.id, v_momento_teste);
  end loop;
end;
$$;

commit;
