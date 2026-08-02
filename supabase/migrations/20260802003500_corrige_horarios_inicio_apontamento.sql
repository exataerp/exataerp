-- Corrige o tipo dos horários gravados ao iniciar uma operação.
-- to_char(...) retorna text, enquanto apontamentos.hora_inicio e hora_fim são time.

create or replace function public.iniciar_apontamento_no_posto(
  p_empresa_id uuid,
  p_ordem_id uuid,
  p_operacao_id uuid,
  p_maquina_id uuid
)
returns public.apontamentos
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_operacao public.operacoes%rowtype;
  v_apontamento public.apontamentos%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Sessão expirada' using errcode = '28000';
  end if;

  if not (select private.pode_acessar_posto_trabalho(p_empresa_id, p_maquina_id)) then
    raise exception 'Você não possui acesso a este posto de trabalho' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.maquinas m
    where m.id = p_maquina_id and m.empresa_id = p_empresa_id and m.status = 'ativa'
  ) then
    raise exception 'Posto de trabalho indisponível' using errcode = '23514';
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

  if not exists (
    select 1 from public.ordens_producao op
    where op.id = p_ordem_id and op.empresa_id = p_empresa_id and coalesce(op.status, '') <> 'encerrada'
  ) then
    raise exception 'Ordem de produção indisponível' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.apontamentos a
    where a.empresa_id = p_empresa_id and a.user_id = (select auth.uid()) and a.status = 'em_andamento'
  ) then
    raise exception 'Já existe um apontamento ativo para este usuário' using errcode = '23505';
  end if;

  insert into public.apontamentos (
    empresa_id, user_id, ordem_id, operacao_id, operacao_nome, maquina_id,
    cronometro_inicio, cronometro_total_segundos, pecas_produzidas,
    pecas_refugo, pecas_retrabalho, status, data_apontamento, hora_inicio, hora_fim
  ) values (
    p_empresa_id, (select auth.uid()), p_ordem_id, p_operacao_id, v_operacao.nome, p_maquina_id,
    now(), 0, 0, 0, 0, 'em_andamento', current_date,
    localtime(0), localtime(0)
  ) returning * into v_apontamento;

  update public.ordens_producao set status = 'em_andamento'
  where id = p_ordem_id and empresa_id = p_empresa_id;

  return v_apontamento;
end;
$$;

revoke all on function public.iniciar_apontamento_no_posto(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.iniciar_apontamento_no_posto(uuid, uuid, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
