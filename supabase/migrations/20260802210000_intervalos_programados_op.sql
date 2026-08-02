-- Intervalos programados de jornada com pausa automática de apontamentos.
-- A automação é executada no banco, usa o fuso da empresa e é idempotente por
-- apontamento + intervalo + data local da jornada.

create schema if not exists private;
revoke all on schema private from public;
create schema if not exists extensions;

alter table public.turnos
  add column if not exists pausar_ops_intervalos boolean not null default true;

alter table public.equipes
  add column if not exists turno_id uuid references public.turnos(id) on delete set null;

alter table public.apontamentos
  add column if not exists estado_operacao text not null default 'em_execucao';

update public.apontamentos
set estado_operacao = case
  when status = 'em_andamento' then 'em_execucao'
  else 'finalizada'
end
where estado_operacao is null
   or (status <> 'em_andamento' and estado_operacao = 'em_execucao');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.apontamentos'::regclass
      and conname = 'apontamentos_estado_operacao_check'
  ) then
    alter table public.apontamentos
      add constraint apontamentos_estado_operacao_check
      check (estado_operacao in (
        'em_execucao',
        'pausada_manual',
        'pausada_intervalo_programado',
        'aguardando_retomada',
        'finalizada'
      ));
  end if;
end;
$$;

create table if not exists public.work_schedule_breaks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.empresas(id) on delete cascade,
  schedule_id uuid not null references public.turnos(id) on delete cascade,
  name text not null,
  start_time time not null,
  end_time time not null,
  days_of_week text[] not null default array['1','2','3','4','5']::text[],
  break_type text not null default 'interval',
  pause_operations_automatically boolean not null default true,
  is_active boolean not null default true,
  execution_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_schedule_breaks_name_check check (length(trim(name)) > 0),
  constraint work_schedule_breaks_time_check check (start_time <> end_time),
  constraint work_schedule_breaks_days_check check (
    cardinality(days_of_week) > 0
    and days_of_week <@ array['0','1','2','3','4','5','6']::text[]
  )
);

create table if not exists public.work_schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.empresas(id) on delete cascade,
  schedule_id uuid references public.turnos(id) on delete cascade,
  exception_date date not null,
  name text not null,
  is_working_day boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists work_schedule_exceptions_unique_idx
  on public.work_schedule_exceptions (
    tenant_id,
    coalesce(schedule_id, '00000000-0000-0000-0000-000000000000'::uuid),
    exception_date
  );

create index if not exists work_schedule_breaks_schedule_idx
  on public.work_schedule_breaks (tenant_id, schedule_id, is_active, execution_order);

create index if not exists equipes_turno_idx
  on public.equipes (empresa_id, turno_id) where ativo and turno_id is not null;

create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_code text not null,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_code)
);

create table if not exists public.user_permissions (
  tenant_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  permission_code text not null,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id, permission_code)
);

insert into public.role_permissions (role_id, permission_code)
select id, 'override_scheduled_break'
from public.roles
where name in ('system_manager', 'production_manager')
on conflict do nothing;

create table if not exists public.production_order_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.empresas(id) on delete cascade,
  production_order_id uuid not null references public.ordens_producao(id) on delete cascade,
  operation_id uuid references public.operacoes(id) on delete set null,
  workstation_id uuid references public.maquinas(id) on delete set null,
  machine_id uuid references public.maquinas(id) on delete set null,
  operator_id uuid references auth.users(id) on delete set null,
  apontamento_id uuid references public.apontamentos(id) on delete cascade,
  schedule_break_id uuid references public.work_schedule_breaks(id) on delete set null,
  schedule_date date,
  event_type text not null,
  event_category text not null,
  source text not null,
  started_at timestamptz not null,
  scheduled_end_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  is_scheduled boolean not null default false,
  exclude_from_machine_downtime boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  resumed_by uuid references auth.users(id) on delete set null,
  resumed_at timestamptz,
  resume_justification text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_order_events_duration_check
    check (duration_seconds is null or duration_seconds >= 0),
  constraint production_order_events_period_check
    check (ended_at is null or ended_at >= started_at)
);

create unique index if not exists production_order_events_scheduled_unique_idx
  on public.production_order_events (
    tenant_id, apontamento_id, schedule_break_id, schedule_date, event_type
  )
  where event_type = 'scheduled_break';

create index if not exists production_order_events_order_history_idx
  on public.production_order_events (tenant_id, production_order_id, started_at desc);

create index if not exists production_order_events_open_scheduled_idx
  on public.production_order_events (scheduled_end_at, tenant_id)
  where event_type = 'scheduled_break' and ended_at is null;

alter table public.apontamentos
  add column if not exists intervalo_programado_evento_id uuid
    references public.production_order_events(id) on delete set null;

alter table public.apontamento_pausas
  add column if not exists event_type text not null default 'manual_stop',
  add column if not exists event_category text not null default 'unplanned_stop',
  add column if not exists source text not null default 'operator',
  add column if not exists is_scheduled boolean not null default false,
  add column if not exists exclude_from_machine_downtime boolean not null default false,
  add column if not exists scheduled_event_id uuid references public.production_order_events(id) on delete set null,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create unique index if not exists apontamento_pausas_scheduled_event_unique_idx
  on public.apontamento_pausas (scheduled_event_id)
  where scheduled_event_id is not null;

create index if not exists apontamentos_estado_operacao_idx
  on public.apontamentos (empresa_id, estado_operacao, maquina_id)
  where status = 'em_andamento';

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists work_schedule_breaks_touch on public.work_schedule_breaks;
create trigger work_schedule_breaks_touch
before update on public.work_schedule_breaks
for each row execute function private.touch_updated_at();

drop trigger if exists work_schedule_exceptions_touch on public.work_schedule_exceptions;
create trigger work_schedule_exceptions_touch
before update on public.work_schedule_exceptions
for each row execute function private.touch_updated_at();

drop trigger if exists production_order_events_touch on public.production_order_events;
create trigger production_order_events_touch
before update on public.production_order_events
for each row execute function private.touch_updated_at();

create or replace function private.pode_sobrescrever_intervalo(
  p_empresa_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_permissions up
    where up.tenant_id = p_empresa_id
      and up.user_id = p_user_id
      and up.permission_code = 'override_scheduled_break'
  ) or exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    where ur.empresa_id = p_empresa_id
      and ur.user_id = p_user_id
      and rp.permission_code = 'override_scheduled_break'
  );
$$;

create or replace function private.fuso_empresa(p_empresa_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(e.timezone, ''), 'America/Sao_Paulo')
  from public.empresas e
  where e.id = p_empresa_id;
$$;

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
begin
  select t.* into v_turno
  from public.turnos t
  where t.id = p_turno_id and t.ativo;

  if not found then return null; end if;

  v_fuso := coalesce(private.fuso_empresa(v_turno.empresa_id), 'America/Sao_Paulo');
  v_local := p_momento at time zone v_fuso;

  if v_turno.hora_fim > v_turno.hora_inicio then
    if v_local::time >= v_turno.hora_inicio and v_local::time < v_turno.hora_fim then
      v_data_jornada := v_local::date;
    else
      return null;
    end if;
  else
    if v_local::time >= v_turno.hora_inicio then
      v_data_jornada := v_local::date;
    elsif v_local::time < v_turno.hora_fim then
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
  -- 1. O turno do posto/máquina é a regra mais específica.
  select m.turno_id into v_turno_id
  from public.maquinas m
  where m.id = p_maquina_id
    and m.empresa_id = p_empresa_id
    and m.turno_id is not null;

  if v_turno_id is not null then
    if private.data_jornada_turno(v_turno_id, p_momento) is not null then
      return v_turno_id;
    end if;
    return null;
  end if;

  -- 2. Depois, equipe que reúne o operador e o posto.
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
  order by e.created_at, e.id
  limit 1;

  if v_turno_id is not null then
    if private.data_jornada_turno(v_turno_id, p_momento) is not null then
      return v_turno_id;
    end if;
    return null;
  end if;

  -- 3. Depois, jornada individual do funcionário.
  select f.turno_id into v_turno_id
  from public.funcionarios f
  where f.empresa_id = p_empresa_id
    and f.user_id = p_user_id
    and f.status = 'ativo'
    and f.turno_id is not null
  order by f.created_at, f.id
  limit 1;

  if v_turno_id is not null then
    if private.data_jornada_turno(v_turno_id, p_momento) is not null then
      return v_turno_id;
    end if;
    return null;
  end if;

  -- 4. Compatibilidade: se nada estiver vinculado, usa o turno ativo no horário.
  select t.id into v_turno_id
  from public.turnos t
  where t.empresa_id = p_empresa_id
    and t.ativo
    and private.data_jornada_turno(t.id, p_momento) is not null
  order by t.hora_inicio, t.id
  limit 1;

  return v_turno_id;
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
begin
  select t.* into v_turno
  from public.turnos t
  where t.id = private.turno_aplicavel_apontamento(
    p_empresa_id, p_user_id, p_maquina_id, p_momento
  );

  if not found or not v_turno.pausar_ops_intervalos then return; end if;

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
    if v_turno.hora_fim <= v_turno.hora_inicio
       and v_break.start_time < v_turno.hora_inicio then
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

create or replace function private.motivo_intervalo_programado(p_empresa_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_grupo_id uuid;
  v_subgrupo_id uuid;
begin
  select g.id into v_grupo_id
  from public.excecao_grupos g
  where g.empresa_id = p_empresa_id
    and lower(trim(g.nome)) = 'paradas programadas'
  order by g.created_at, g.id
  limit 1;

  if v_grupo_id is null then
    insert into public.excecao_grupos (empresa_id, nome)
    values (p_empresa_id, 'Paradas Programadas')
    returning id into v_grupo_id;
  end if;

  select s.id into v_subgrupo_id
  from public.excecao_subgrupos s
  where s.empresa_id = p_empresa_id
    and s.grupo_id = v_grupo_id
    and lower(trim(s.nome)) = 'intervalo programado'
  order by s.created_at, s.id
  limit 1;

  if v_subgrupo_id is null then
    insert into public.excecao_subgrupos (empresa_id, grupo_id, nome)
    values (p_empresa_id, v_grupo_id, 'Intervalo Programado')
    returning id into v_subgrupo_id;
  end if;

  return v_subgrupo_id;
end;
$$;

create or replace function public.processar_intervalos_programados(
  p_momento timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_item record;
  v_apontamento public.apontamentos%rowtype;
  v_evento_id uuid;
  v_subgrupo_id uuid;
  v_pausados integer := 0;
  v_encerrados integer := 0;
  v_total_segundos integer;
begin
  -- Evita duas instâncias globais do job processando o mesmo minuto.
  if not pg_try_advisory_xact_lock(hashtextextended('exata:scheduled-breaks', 0)) then
    return jsonb_build_object('executado', false, 'motivo', 'concorrente');
  end if;

  for v_item in
    select
      a.id as apontamento_id,
      i.break_id,
      i.schedule_id,
      i.break_name,
      i.occurrence_date,
      i.starts_at,
      i.ends_at,
      i.timezone_name
    from public.apontamentos a
    cross join lateral private.intervalo_programado_ativo(
      a.empresa_id, a.user_id, a.maquina_id, p_momento
    ) i
    where a.status = 'em_andamento'
      and a.estado_operacao = 'em_execucao'
      and a.cronometro_inicio is not null
    order by a.empresa_id, a.id
  loop
    select a.* into v_apontamento
    from public.apontamentos a
    where a.id = v_item.apontamento_id
    for update;

    if not found
       or v_apontamento.status <> 'em_andamento'
       or v_apontamento.estado_operacao <> 'em_execucao'
       or v_apontamento.cronometro_inicio is null then
      continue;
    end if;

    -- Um início autorizado dentro do intervalo não deve ser pausado pelo job.
    if exists (
      select 1
      from public.production_order_events oe
      where oe.tenant_id = v_apontamento.empresa_id
        and oe.apontamento_id = v_apontamento.id
        and oe.schedule_break_id = v_item.break_id
        and oe.schedule_date = v_item.occurrence_date
        and oe.event_type = 'scheduled_break_override'
        and oe.metadata ->> 'action' = 'start'
    ) then
      continue;
    end if;

    insert into public.production_order_events (
      tenant_id, production_order_id, operation_id, workstation_id, machine_id,
      operator_id, apontamento_id, schedule_break_id, schedule_date,
      event_type, event_category, source, started_at, scheduled_end_at,
      is_scheduled, exclude_from_machine_downtime, metadata
    ) values (
      v_apontamento.empresa_id, v_apontamento.ordem_id,
      v_apontamento.operacao_id, v_apontamento.maquina_id, v_apontamento.maquina_id,
      v_apontamento.user_id, v_apontamento.id, v_item.break_id, v_item.occurrence_date,
      'scheduled_break', 'planned_stop', 'system', v_item.starts_at, v_item.ends_at,
      true, true,
      jsonb_build_object(
        'break_name', v_item.break_name,
        'schedule_id', v_item.schedule_id,
        'timezone', v_item.timezone_name,
        'processed_at', p_momento,
        'scheduled_duration_seconds', greatest(extract(epoch from (v_item.ends_at - v_item.starts_at))::integer, 0)
      )
    )
    on conflict do nothing
    returning id into v_evento_id;

    if v_evento_id is null then continue; end if;

    v_total_segundos := coalesce(v_apontamento.cronometro_total_segundos, 0)
      + greatest(
          extract(epoch from (v_item.starts_at - v_apontamento.cronometro_inicio))::integer,
          0
        );

    update public.apontamentos
    set cronometro_total_segundos = v_total_segundos,
        cronometro_inicio = null,
        estado_operacao = 'pausada_intervalo_programado',
        intervalo_programado_evento_id = v_evento_id
    where id = v_apontamento.id;

    v_subgrupo_id := private.motivo_intervalo_programado(v_apontamento.empresa_id);

    insert into public.apontamento_pausas (
      empresa_id, apontamento_id, subgrupo_id, inicio,
      event_type, event_category, source, is_scheduled,
      exclude_from_machine_downtime, scheduled_event_id, metadata
    ) values (
      v_apontamento.empresa_id, v_apontamento.id, v_subgrupo_id, v_item.starts_at,
      'scheduled_break', 'planned_stop', 'system', true, true, v_evento_id,
      jsonb_build_object('break_name', v_item.break_name, 'scheduled_end_at', v_item.ends_at)
    );

    v_pausados := v_pausados + 1;
    v_evento_id := null;
  end loop;

  -- O fim do intervalo apenas libera a retomada; nunca reinicia o cronômetro.
  for v_item in
    select e.*
    from public.production_order_events e
    where e.event_type = 'scheduled_break'
      and e.ended_at is null
      and e.scheduled_end_at <= p_momento
    order by e.scheduled_end_at, e.id
    for update skip locked
  loop
    update public.production_order_events
    set ended_at = v_item.scheduled_end_at,
        duration_seconds = greatest(
          extract(epoch from (v_item.scheduled_end_at - v_item.started_at))::integer,
          0
        )
    where id = v_item.id;

    update public.apontamento_pausas
    set fim = v_item.scheduled_end_at
    where scheduled_event_id = v_item.id and fim is null;

    update public.apontamentos
    set estado_operacao = 'aguardando_retomada'
    where id = v_item.apontamento_id
      and status = 'em_andamento'
      and estado_operacao = 'pausada_intervalo_programado'
      and intervalo_programado_evento_id = v_item.id;

    v_encerrados := v_encerrados + 1;
  end loop;

  return jsonb_build_object(
    'executado', true,
    'momento', p_momento,
    'apontamentos_pausados', v_pausados,
    'intervalos_encerrados', v_encerrados
  );
end;
$$;

create or replace function public.pausar_apontamento_manual(
  p_empresa_id uuid,
  p_apontamento_id uuid,
  p_subgrupo_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_apontamento public.apontamentos%rowtype;
  v_pausa_id uuid;
  v_agora timestamptz := now();
  v_total integer;
begin
  if v_user_id is null then
    raise exception 'Sessão expirada' using errcode = '28000';
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

  if v_apontamento.status <> 'em_andamento'
     or v_apontamento.estado_operacao <> 'em_execucao'
     or v_apontamento.cronometro_inicio is null then
    raise exception 'A operação não está em execução' using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.excecao_subgrupos s
    where s.id = p_subgrupo_id and s.empresa_id = p_empresa_id
  ) then
    raise exception 'Motivo de pausa inválido' using errcode = '23503';
  end if;

  v_total := coalesce(v_apontamento.cronometro_total_segundos, 0)
    + greatest(extract(epoch from (v_agora - v_apontamento.cronometro_inicio))::integer, 0);

  insert into public.apontamento_pausas (
    empresa_id, apontamento_id, subgrupo_id, inicio,
    event_type, event_category, source, is_scheduled,
    exclude_from_machine_downtime
  ) values (
    p_empresa_id, p_apontamento_id, p_subgrupo_id, v_agora,
    'manual_stop', 'unplanned_stop', 'operator', false, false
  ) returning id into v_pausa_id;

  update public.apontamentos
  set cronometro_total_segundos = v_total,
      cronometro_inicio = null,
      estado_operacao = 'pausada_manual'
  where id = p_apontamento_id;

  return jsonb_build_object(
    'pausa_id', v_pausa_id,
    'paused_at', v_agora,
    'total_seconds', v_total,
    'state', 'pausada_manual'
  );
end;
$$;

create or replace function public.sincronizar_estado_final_apontamento()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.status <> 'em_andamento' and old.status = 'em_andamento' then
    new.estado_operacao := 'finalizada';
    new.cronometro_inicio := null;

    update public.apontamento_pausas
    set fim = coalesce(fim, now())
    where apontamento_id = new.id and fim is null;

    if new.intervalo_programado_evento_id is not null then
      update public.production_order_events
      set ended_at = coalesce(ended_at, now()),
          duration_seconds = greatest(
            extract(epoch from (coalesce(ended_at, now()) - started_at))::integer,
            0
          )
      where id = new.intervalo_programado_evento_id;
    end if;

    new.intervalo_programado_evento_id := null;
  end if;

  return new;
end;
$$;

drop trigger if exists apontamentos_sincronizar_estado_final on public.apontamentos;
create trigger apontamentos_sincronizar_estado_final
before update of status on public.apontamentos
for each row execute function public.sincronizar_estado_final_apontamento();

revoke all on function public.sincronizar_estado_final_apontamento()
  from public, anon, authenticated;

create or replace function public.retomar_apontamento(
  p_empresa_id uuid,
  p_apontamento_id uuid,
  p_override boolean default false,
  p_justificativa text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_apontamento public.apontamentos%rowtype;
  v_evento public.production_order_events%rowtype;
  v_intervalo record;
  v_agora timestamptz := now();
  v_pausa_id uuid;
begin
  if v_user_id is null then
    raise exception 'Sessão expirada' using errcode = '28000';
  end if;

  select a.* into v_apontamento
  from public.apontamentos a
  where a.id = p_apontamento_id
    and a.empresa_id = p_empresa_id
    and (
      a.user_id = v_user_id
      or private.pode_sobrescrever_intervalo(p_empresa_id, v_user_id)
    )
  for update;

  if not found then
    raise exception 'Apontamento não encontrado' using errcode = '42501';
  end if;

  if v_apontamento.status <> 'em_andamento'
     or v_apontamento.estado_operacao not in (
       'pausada_manual', 'pausada_intervalo_programado', 'aguardando_retomada'
     ) then
    raise exception 'A operação não está pausada' using errcode = '23514';
  end if;

  select * into v_intervalo
  from private.intervalo_programado_ativo(
    p_empresa_id, v_apontamento.user_id, v_apontamento.maquina_id, v_agora
  )
  limit 1;

  if found then
    if not p_override then
      raise exception 'Não é possível retomar esta operação durante o intervalo programado. A jornada será retomada às %.',
        to_char(v_intervalo.ends_at at time zone v_intervalo.timezone_name, 'HH24:MI')
        using errcode = 'P0001';
    end if;

    if not private.pode_sobrescrever_intervalo(p_empresa_id, v_user_id) then
      raise exception 'Usuário sem permissão override_scheduled_break' using errcode = '42501';
    end if;

    if length(trim(coalesce(p_justificativa, ''))) < 5 then
      raise exception 'Informe uma justificativa para a retomada antecipada' using errcode = '22023';
    end if;
  end if;

  if v_apontamento.intervalo_programado_evento_id is not null then
    select e.* into v_evento
    from public.production_order_events e
    where e.id = v_apontamento.intervalo_programado_evento_id
      and e.tenant_id = p_empresa_id
    for update;

    if found then
      update public.production_order_events
      set ended_at = coalesce(ended_at, least(v_agora, scheduled_end_at)),
          duration_seconds = greatest(
            extract(epoch from (coalesce(ended_at, least(v_agora, scheduled_end_at)) - started_at))::integer,
            0
          ),
          resumed_by = v_user_id,
          resumed_at = v_agora,
          resume_justification = nullif(trim(coalesce(p_justificativa, '')), '')
      where id = v_evento.id;

      update public.apontamento_pausas
      set fim = coalesce(fim, least(v_agora, v_evento.scheduled_end_at))
      where scheduled_event_id = v_evento.id;

      if p_override and v_intervalo.break_id is not null then
        insert into public.production_order_events (
          tenant_id, production_order_id, operation_id, workstation_id, machine_id,
          operator_id, apontamento_id, schedule_break_id, schedule_date,
          event_type, event_category, source, started_at, ended_at, duration_seconds,
          is_scheduled, exclude_from_machine_downtime, created_by, metadata
        ) values (
          p_empresa_id, v_apontamento.ordem_id, v_apontamento.operacao_id,
          v_apontamento.maquina_id, v_apontamento.maquina_id,
          v_apontamento.user_id, v_apontamento.id, v_intervalo.break_id,
          v_intervalo.occurrence_date, 'scheduled_break_override', 'planned_stop',
          'user_override', v_agora, v_agora, 0, true, true, v_user_id,
          jsonb_build_object('action', 'early_resume', 'justification', trim(p_justificativa))
        );
      end if;
    end if;
  else
    select p.id into v_pausa_id
    from public.apontamento_pausas p
    where p.empresa_id = p_empresa_id
      and p.apontamento_id = p_apontamento_id
      and p.fim is null
    order by p.inicio desc
    limit 1
    for update;

    if v_pausa_id is not null then
      update public.apontamento_pausas set fim = v_agora where id = v_pausa_id;
    end if;
  end if;

  update public.apontamentos
  set estado_operacao = 'em_execucao',
      cronometro_inicio = v_agora,
      intervalo_programado_evento_id = null
  where id = p_apontamento_id;

  return jsonb_build_object(
    'resumed_at', v_agora,
    'total_seconds', coalesce(v_apontamento.cronometro_total_segundos, 0),
    'state', 'em_execucao'
  );
end;
$$;

drop function if exists public.iniciar_apontamento_no_posto(uuid, uuid, uuid, uuid);

create function public.iniciar_apontamento_no_posto(
  p_empresa_id uuid,
  p_ordem_id uuid,
  p_operacao_id uuid,
  p_maquina_id uuid,
  p_override boolean default false,
  p_justificativa text default null
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
  v_agora timestamptz := now();
  v_fuso text;
begin
  if v_user_id is null then
    raise exception 'Sessão expirada' using errcode = '28000';
  end if;

  if not private.pode_acessar_posto_trabalho(p_empresa_id, p_maquina_id) then
    raise exception 'Você não possui acesso a este posto de trabalho' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.maquinas m
    where m.id = p_maquina_id and m.empresa_id = p_empresa_id and m.status = 'ativa'
  ) then
    raise exception 'Posto de trabalho indisponível' using errcode = '23514';
  end if;

  select * into v_intervalo
  from private.intervalo_programado_ativo(p_empresa_id, v_user_id, p_maquina_id, v_agora)
  limit 1;

  if found then
    if not p_override then
      raise exception 'Não é possível iniciar esta operação durante o intervalo programado. A jornada será retomada às %.',
        to_char(v_intervalo.ends_at at time zone v_intervalo.timezone_name, 'HH24:MI')
        using errcode = 'P0001';
    end if;

    if not private.pode_sobrescrever_intervalo(p_empresa_id, v_user_id) then
      raise exception 'Usuário sem permissão override_scheduled_break' using errcode = '42501';
    end if;

    if length(trim(coalesce(p_justificativa, ''))) < 5 then
      raise exception 'Informe uma justificativa para iniciar durante o intervalo' using errcode = '22023';
    end if;
  end if;

  select o.* into v_operacao
  from public.operacoes o
  join public.operacao_postos_trabalho opt
    on opt.operacao_id = o.id and opt.empresa_id = o.empresa_id and opt.ativo
  join public.produtos p
    on p.id = o.produto_id and p.empresa_id = o.empresa_id
  join public.ordens_producao ordem
    on ordem.id = p_ordem_id
   and ordem.empresa_id = o.empresa_id
   and ordem.produto_codigo = p.codigo
   and coalesce(ordem.status, '') <> 'encerrada'
  where o.id = p_operacao_id
    and o.empresa_id = p_empresa_id
    and opt.maquina_id = p_maquina_id;

  if not found then
    raise exception 'A operação não pertence ao posto selecionado' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.apontamentos a
    where a.empresa_id = p_empresa_id
      and a.user_id = v_user_id
      and a.status = 'em_andamento'
  ) then
    raise exception 'Já existe um apontamento ativo para este usuário' using errcode = '23505';
  end if;

  v_fuso := coalesce(private.fuso_empresa(p_empresa_id), 'America/Sao_Paulo');

  insert into public.apontamentos (
    empresa_id, user_id, ordem_id, operacao_id, operacao_nome, maquina_id,
    cronometro_inicio, cronometro_total_segundos, pecas_produzidas,
    pecas_refugo, pecas_retrabalho, status, estado_operacao,
    data_apontamento, hora_inicio, hora_fim
  ) values (
    p_empresa_id, v_user_id, p_ordem_id, p_operacao_id, v_operacao.nome, p_maquina_id,
    v_agora, 0, 0, 0, 0, 'em_andamento', 'em_execucao',
    (v_agora at time zone v_fuso)::date,
    (v_agora at time zone v_fuso)::time(0),
    (v_agora at time zone v_fuso)::time(0)
  ) returning * into v_apontamento;

  update public.ordens_producao set status = 'em_andamento'
  where id = p_ordem_id and empresa_id = p_empresa_id;

  if v_intervalo.break_id is not null then
    insert into public.production_order_events (
      tenant_id, production_order_id, operation_id, workstation_id, machine_id,
      operator_id, apontamento_id, schedule_break_id, schedule_date,
      event_type, event_category, source, started_at, ended_at, duration_seconds,
      is_scheduled, exclude_from_machine_downtime, created_by, metadata
    ) values (
      p_empresa_id, p_ordem_id, p_operacao_id, p_maquina_id, p_maquina_id,
      v_user_id, v_apontamento.id, v_intervalo.break_id, v_intervalo.occurrence_date,
      'scheduled_break_override', 'planned_stop', 'user_override',
      v_agora, v_agora, 0, true, true, v_user_id,
      jsonb_build_object('action', 'start', 'justification', trim(p_justificativa))
    );
  end if;

  return v_apontamento;
end;
$$;

alter table public.work_schedule_breaks enable row level security;
alter table public.work_schedule_exceptions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_permissions enable row level security;
alter table public.production_order_events enable row level security;

revoke all on public.work_schedule_breaks, public.work_schedule_exceptions,
  public.role_permissions, public.user_permissions, public.production_order_events
  from anon;

grant select on public.work_schedule_breaks, public.work_schedule_exceptions,
  public.role_permissions, public.user_permissions, public.production_order_events
  to authenticated;
grant insert, update, delete on public.work_schedule_breaks, public.work_schedule_exceptions,
  public.user_permissions to authenticated;
grant select, insert, update, delete on public.work_schedule_breaks,
  public.work_schedule_exceptions, public.role_permissions, public.user_permissions,
  public.production_order_events to service_role;

drop policy if exists "intervalos: empresa visualiza" on public.work_schedule_breaks;
create policy "intervalos: empresa visualiza" on public.work_schedule_breaks
for select to authenticated
using (public.tem_acesso_empresa(tenant_id) or public.is_master());

drop policy if exists "intervalos: gestor administra" on public.work_schedule_breaks;
create policy "intervalos: gestor administra" on public.work_schedule_breaks
for all to authenticated
using (private.eh_gestor_producao(tenant_id) or public.is_master())
with check (private.eh_gestor_producao(tenant_id) or public.is_master());

drop policy if exists "excecoes jornada: empresa visualiza" on public.work_schedule_exceptions;
create policy "excecoes jornada: empresa visualiza" on public.work_schedule_exceptions
for select to authenticated
using (public.tem_acesso_empresa(tenant_id) or public.is_master());

drop policy if exists "excecoes jornada: gestor administra" on public.work_schedule_exceptions;
create policy "excecoes jornada: gestor administra" on public.work_schedule_exceptions
for all to authenticated
using (private.eh_gestor_producao(tenant_id) or public.is_master())
with check (private.eh_gestor_producao(tenant_id) or public.is_master());

drop policy if exists "permissoes de papel: autenticado visualiza" on public.role_permissions;
create policy "permissoes de papel: autenticado visualiza" on public.role_permissions
for select to authenticated using (true);

drop policy if exists "permissoes usuario: proprio ou gestor visualiza" on public.user_permissions;
create policy "permissoes usuario: proprio ou gestor visualiza" on public.user_permissions
for select to authenticated
using (
  user_id = auth.uid()
  or private.eh_gestor_producao(tenant_id)
  or public.is_master()
);

drop policy if exists "permissoes usuario: gestor administra" on public.user_permissions;
create policy "permissoes usuario: gestor administra" on public.user_permissions
for all to authenticated
using (private.eh_gestor_producao(tenant_id) or public.is_master())
with check (private.eh_gestor_producao(tenant_id) or public.is_master());

drop policy if exists "eventos op: empresa visualiza" on public.production_order_events;
create policy "eventos op: empresa visualiza" on public.production_order_events
for select to authenticated
using (public.tem_acesso_empresa(tenant_id) or public.is_master());

revoke all on function private.pode_sobrescrever_intervalo(uuid, uuid),
  private.fuso_empresa(uuid),
  private.data_jornada_turno(uuid, timestamptz),
  private.turno_aplicavel_apontamento(uuid, uuid, uuid, timestamptz),
  private.intervalo_programado_ativo(uuid, uuid, uuid, timestamptz),
  private.motivo_intervalo_programado(uuid)
from public, anon, authenticated;

revoke all on function public.processar_intervalos_programados(timestamptz)
  from public, anon, authenticated;
grant execute on function public.processar_intervalos_programados(timestamptz) to service_role;

revoke all on function public.pausar_apontamento_manual(uuid, uuid, uuid),
  public.retomar_apontamento(uuid, uuid, boolean, text),
  public.iniciar_apontamento_no_posto(uuid, uuid, uuid, uuid, boolean, text)
from public, anon, authenticated;

grant execute on function public.pausar_apontamento_manual(uuid, uuid, uuid),
  public.retomar_apontamento(uuid, uuid, boolean, text),
  public.iniciar_apontamento_no_posto(uuid, uuid, uuid, uuid, boolean, text)
to authenticated;

-- Agenda o processamento a cada minuto quando pg_cron está disponível no projeto.
do $$
begin
  begin
    execute 'create extension if not exists pg_cron with schema extensions';
  exception
    when insufficient_privilege or undefined_file then
      raise notice 'pg_cron não pôde ser instalado automaticamente; a função processar_intervalos_programados permanece disponível.';
  end;

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

notify pgrst, 'reload schema';
