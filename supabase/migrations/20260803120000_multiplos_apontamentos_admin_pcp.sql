-- Administradores e PCP (Gestor de Produção) podem manter vários apontamentos
-- ativos. Os demais perfis continuam limitados a um por empresa e usuário.

create or replace function private.pode_iniciar_multiplos_apontamentos(
  p_empresa_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.empresa_id = p_empresa_id
      and ur.user_id = p_user_id
      and r.name in ('system_manager', 'production_manager')
  );
$$;

-- O índice único anterior não consegue expressar uma exceção baseada no perfil.
drop index if exists public.apontamentos_um_ativo_por_usuario_idx;

create index if not exists apontamentos_ativos_por_usuario_idx
  on public.apontamentos (empresa_id, user_id)
  where status = 'em_andamento' and user_id is not null;

-- Mantém a regra para todos os caminhos de escrita, não apenas para a tela.
-- O advisory lock serializa tentativas concorrentes do mesmo usuário comum.
create or replace function private.validar_limite_apontamento_ativo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'em_andamento' or new.user_id is null then
    return new;
  end if;

  if private.pode_iniciar_multiplos_apontamentos(new.empresa_id, new.user_id) then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'exata:apontamento-ativo:' || new.empresa_id::text || ':' || new.user_id::text,
      0
    )
  );

  if exists (
    select 1
    from public.apontamentos a
    where a.empresa_id = new.empresa_id
      and a.user_id = new.user_id
      and a.status = 'em_andamento'
      and a.id is distinct from new.id
  ) then
    raise exception 'Já existe um apontamento ativo para este usuário'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists apontamentos_limite_ativo_insert on public.apontamentos;
create trigger apontamentos_limite_ativo_insert
before insert on public.apontamentos
for each row execute function private.validar_limite_apontamento_ativo();

drop trigger if exists apontamentos_limite_ativo_update on public.apontamentos;
create trigger apontamentos_limite_ativo_update
before update of empresa_id, user_id, status on public.apontamentos
for each row execute function private.validar_limite_apontamento_ativo();

-- Substitui a validação antiga da RPC; o trigger acima aplica o limite somente
-- aos perfis comuns e deixa Administrador/PCP iniciarem sem limite.
create or replace function public.iniciar_apontamento_no_posto(
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

revoke all on function private.pode_iniciar_multiplos_apontamentos(uuid, uuid),
  private.validar_limite_apontamento_ativo()
from public, anon, authenticated;

revoke all on function public.iniciar_apontamento_no_posto(uuid, uuid, uuid, uuid, boolean, text)
from public, anon, authenticated;
grant execute on function public.iniciar_apontamento_no_posto(uuid, uuid, uuid, uuid, boolean, text)
to authenticated;

notify pgrst, 'reload schema';
