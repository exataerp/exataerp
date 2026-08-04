-- Bloqueio definitivo de exclusao de OP com qualquer historico produtivo.
-- A migration e aditiva para o legado e remove os ultimos CASCADEs que
-- poderiam apagar eventos ou snapshots quando uma OP fosse removida.

begin;

set local lock_timeout = '3s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- Serializacao entre inicio de apontamento e exclusao da OP
-- ---------------------------------------------------------------------------

create or replace function private.serializar_apontamento_com_ordem()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.empresa_id is not null and new.ordem_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      pg_catalog.concat_ws(
        ':', 'ordem-producao', new.empresa_id::text, new.ordem_id::text
      ),
      0
    ));
  end if;
  return new;
end;
$$;

drop trigger if exists apontamentos_serializar_ordem
on public.apontamentos;
create trigger apontamentos_serializar_ordem
before insert or update of empresa_id, ordem_id
on public.apontamentos
for each row execute function private.serializar_apontamento_com_ordem();

revoke all on function private.serializar_apontamento_com_ordem()
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Nenhum historico da OP pode desaparecer por CASCADE
-- ---------------------------------------------------------------------------

alter table public.ordem_producao_operacoes
  drop constraint if exists ordem_producao_operacoes_ordem_id_fkey;
alter table public.ordem_producao_operacoes
  add constraint ordem_producao_operacoes_ordem_id_fkey
  foreign key (ordem_id) references public.ordens_producao(id)
  on delete restrict;

alter table public.ordem_producao_bom_itens
  drop constraint if exists ordem_producao_bom_itens_ordem_id_fkey;
alter table public.ordem_producao_bom_itens
  add constraint ordem_producao_bom_itens_ordem_id_fkey
  foreign key (ordem_id) references public.ordens_producao(id)
  on delete restrict;

alter table public.production_order_events
  drop constraint if exists production_order_events_production_order_id_fkey;
alter table public.production_order_events
  add constraint production_order_events_production_order_id_fkey
  foreign key (production_order_id) references public.ordens_producao(id)
  on delete restrict;

-- ---------------------------------------------------------------------------
-- Resumo unico das dependencias usado pela trigger e pela RPC
-- ---------------------------------------------------------------------------

create or replace function private.resumo_dependencias_ordem(
  p_empresa_id uuid,
  p_ordem_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with apontamentos_ordem as (
    select a.*
    from public.apontamentos a
    where a.empresa_id = p_empresa_id
      and a.ordem_id = p_ordem_id
  ),
  usuarios as (
    select coalesce(
      jsonb_agg(jsonb_build_object(
        'id', u.user_id,
        'nome', coalesce(p.nome, p.email, u.user_id::text)
      ) order by coalesce(p.nome, p.email, u.user_id::text)),
      '[]'::jsonb
    ) as itens
    from (
      select distinct a.user_id
      from apontamentos_ordem a
      where a.user_id is not null
    ) u
    left join public.perfis p
      on p.user_id = u.user_id
     and p.empresa_id = p_empresa_id
  ),
  movimentos as (
    select me.*
    from public.movimentacoes_estoque me
    where me.empresa_id = p_empresa_id
      and (
        me.referencia_id = p_ordem_id
        or exists (
          select 1 from apontamentos_ordem a
          where a.id = me.referencia_id
             or a.id = me.reversal_apontamento_id
        )
      )
  )
  select jsonb_build_object(
    'total_apontamentos', (select count(*) from apontamentos_ordem),
    'apontamentos_ativos', (
      select count(*) from apontamentos_ordem a
      where lower(coalesce(a.status, '')) in ('em_andamento', 'ativo', 'em_execucao')
         or lower(coalesce(a.estado_operacao, '')) in ('em_andamento', 'ativo', 'em_execucao')
    ),
    'apontamentos_pausados', (
      select count(*) from apontamentos_ordem a
      where lower(coalesce(a.status, '')) like 'paus%'
         or lower(coalesce(a.estado_operacao, '')) like 'paus%'
         or exists (
           select 1 from public.apontamento_pausas ap
           where ap.apontamento_id = a.id and ap.fim is null
         )
    ),
    'apontamentos_finalizados', (
      select count(*) from apontamentos_ordem a
      where a.estornado_em is null
        and (
          a.finalizado_em is not null
          or lower(coalesce(a.status, '')) in (
            'finalizado', 'finalizada', 'concluido', 'concluida',
            'encerrado', 'encerrada', 'parcial'
          )
        )
    ),
    'apontamentos_estornados', (
      select count(*) from apontamentos_ordem a where a.estornado_em is not null
    ),
    'usuarios', (select itens from usuarios),
    'primeiro_apontamento', (
      select min(coalesce(a.cronometro_inicio, a.created_at, a.updated_at))
      from apontamentos_ordem a
    ),
    'ultimo_apontamento', (
      select max(coalesce(a.finalizado_em, a.updated_at, a.created_at))
      from apontamentos_ordem a
    ),
    'pausas', (
      select count(*)
      from public.apontamento_pausas ap
      where exists (
        select 1 from apontamentos_ordem a where a.id = ap.apontamento_id
      )
    ),
    'refugos', (
      select coalesce(sum(coalesce(a.pecas_refugo, 0)), 0)
      from apontamentos_ordem a
    ),
    'movimentos_estoque', (select count(*) from movimentos),
    'movimentos_estoque_ativos', (
      select count(*)
      from movimentos m
      where m.reverses_movement_id is null
        and not exists (
          select 1 from public.movimentacoes_estoque inversa
          where inversa.reverses_movement_id = m.id
        )
    ),
    'utilizado_no_oee', exists (
      select 1 from apontamentos_ordem a
      where a.estornado_em is null
        and (
          coalesce(a.cronometro_total_segundos, 0) > 0
          or coalesce(a.pecas_produzidas, 0) > 0
          or coalesce(a.pecas_refugo, 0) > 0
          or coalesce(a.pecas_retrabalho, 0) > 0
        )
    ),
    'eventos_produtivos', (
      select count(*) from public.production_order_events e
      where e.tenant_id = p_empresa_id
        and e.production_order_id = p_ordem_id
    ),
    'snapshot_operacoes', (
      select count(*) from public.ordem_producao_operacoes s
      where s.empresa_id = p_empresa_id and s.ordem_id = p_ordem_id
    ),
    'snapshot_bom', (
      select count(*) from public.ordem_producao_bom_itens b
      where b.empresa_id = p_empresa_id and b.ordem_id = p_ordem_id
    )
  );
$$;

revoke all on function private.resumo_dependencias_ordem(uuid, uuid)
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Trigger: DELETE direto nunca e um caminho valido para ordens
-- ---------------------------------------------------------------------------

create or replace function private.proteger_exclusao_historica()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dependencias jsonb;
begin
  if tg_table_name = 'ordens_producao' then
    if coalesce(current_setting('app.safe_order_delete', true), '') <> old.id::text then
      raise exception 'Exclusao direta de Ordem de Producao bloqueada. Use a RPC excluir_ordem_producao_segura.'
        using errcode = '42501';
    end if;

    v_dependencias := private.resumo_dependencias_ordem(old.empresa_id, old.id);
    if coalesce((v_dependencias ->> 'total_apontamentos')::integer, 0) > 0 then
      raise exception 'Esta Ordem de Producao nao pode ser excluida porque possui apontamentos de producao relacionados.'
        using errcode = '23503';
    end if;
    if coalesce((v_dependencias ->> 'eventos_produtivos')::integer, 0) > 0
       or coalesce((v_dependencias ->> 'movimentos_estoque')::integer, 0) > 0
       or coalesce((v_dependencias ->> 'pausas')::integer, 0) > 0 then
      raise exception 'A Ordem de Producao possui historico operacional e nao pode ser excluida.'
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

revoke all on function private.proteger_exclusao_historica()
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC unica de exclusao: somente administrador e somente rascunho limpo
-- ---------------------------------------------------------------------------

create or replace function public.excluir_ordem_producao_segura(
  p_empresa_id uuid,
  p_ordem_id uuid,
  p_motivo text,
  p_confirmar boolean,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ordem public.ordens_producao%rowtype;
  v_dependencias jsonb;
  v_snapshot_operacoes jsonb := '[]'::jsonb;
  v_snapshot_bom jsonb := '[]'::jsonb;
  v_resultado jsonb;
  v_audit_id uuid := gen_random_uuid();
  v_codigo text;
  v_mensagem text;
begin
  if v_user_id is null then
    raise exception 'Sessao expirada' using errcode = '28000';
  end if;

  if not (
    public.is_master()
    or private.tem_permissao_auditoria(
      p_empresa_id, 'auditoria.estornar', v_user_id
    )
  ) then
    raise exception 'Somente um administrador autorizado pode excluir uma Ordem de Producao'
      using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'A chave de idempotencia e obrigatoria'
      using errcode = '22023';
  end if;

  select al.metadata -> 'result'
  into v_resultado
  from public.audit_logs al
  where al.tenant_id = p_empresa_id
    and al.entity_type = 'ordem_producao'
    and al.entity_id = p_ordem_id
    and al.idempotency_key = p_idempotency_key
  order by al.created_at desc
  limit 1;

  if v_resultado is not null then
    return v_resultado || jsonb_build_object('idempotente', true);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      ':', 'ordem-producao', p_empresa_id::text, p_ordem_id::text
    ),
    0
  ));

  select op.* into v_ordem
  from public.ordens_producao op
  where op.id = p_ordem_id
    and op.empresa_id = p_empresa_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'code', 'OP_NOT_FOUND',
      'ordem_id', p_ordem_id,
      'message', 'Ordem de Producao nao encontrada neste tenant.'
    );
  end if;

  -- Congela todas as dependencias relevantes na mesma transacao.
  perform 1 from public.apontamentos a
  where a.empresa_id = p_empresa_id and a.ordem_id = p_ordem_id
  for update;
  perform 1 from public.production_order_events e
  where e.tenant_id = p_empresa_id and e.production_order_id = p_ordem_id
  for update;
  perform 1 from public.apontamento_pausas ap
  where ap.empresa_id = p_empresa_id
    and exists (
      select 1 from public.apontamentos a
      where a.id = ap.apontamento_id and a.ordem_id = p_ordem_id
    )
  for update;
  perform 1 from public.movimentacoes_estoque me
  where me.empresa_id = p_empresa_id
    and (
      me.referencia_id = p_ordem_id
      or exists (
        select 1 from public.apontamentos a
        where a.empresa_id = p_empresa_id
          and a.ordem_id = p_ordem_id
          and (a.id = me.referencia_id or a.id = me.reversal_apontamento_id)
      )
    )
  for update;

  v_dependencias := private.resumo_dependencias_ordem(p_empresa_id, p_ordem_id);

  if coalesce((v_dependencias ->> 'total_apontamentos')::integer, 0) > 0 then
    v_codigo := 'OP_HAS_POINTINGS';
    v_mensagem := 'Esta Ordem de Producao nao pode ser excluida porque possui apontamentos de producao relacionados. Para excluir a OP, primeiro estorne ou exclua de forma auditada todos os apontamentos vinculados.';
  elsif lower(coalesce(v_ordem.status, '')) not in ('planejada', 'aberta', 'rascunho') then
    v_codigo := 'OP_NOT_DRAFT';
    v_mensagem := 'Somente uma Ordem de Producao em rascunho, nunca iniciada e sem historico pode ser excluida.';
  elsif coalesce((v_dependencias ->> 'eventos_produtivos')::integer, 0) > 0
     or coalesce((v_dependencias ->> 'movimentos_estoque')::integer, 0) > 0
     or coalesce((v_dependencias ->> 'pausas')::integer, 0) > 0
     or coalesce(v_ordem.quantidade_produzida, 0) <> 0
     or coalesce(v_ordem.quantidade_aprovada, 0) <> 0
     or coalesce(v_ordem.quantidade_aprovada_estoque, 0) <> 0 then
    v_codigo := 'OP_HAS_OPERATIONAL_HISTORY';
    v_mensagem := 'A Ordem de Producao possui efeitos operacionais ou historico e nao pode ser excluida. Utilize o cancelamento e os estornos auditados.';
  end if;

  if v_codigo is not null then
    v_resultado := jsonb_build_object(
      'success', false,
      'code', v_codigo,
      'message', v_mensagem,
      'ordem_id', p_ordem_id,
      'numero_op', v_ordem.numero_op,
      'dependencies', v_dependencias,
      'required_action', 'Abra a Auditoria, trate todos os apontamentos e efeitos e mantenha a evidencia historica.'
    );

    insert into public.audit_logs (
      id, tenant_id, entity_type, entity_id, action, module,
      original_record_id, performed_by, reason_code, reason_description,
      old_values, new_values, affected_records, metadata,
      idempotency_key
    ) values (
      v_audit_id, p_empresa_id, 'ordem_producao', p_ordem_id,
      'order_delete_blocked', 'pcp', p_ordem_id, v_user_id,
      lower(v_codigo), nullif(trim(coalesce(p_motivo, '')), ''),
      to_jsonb(v_ordem), '{}'::jsonb, v_dependencias,
      jsonb_build_object('result', v_resultado), p_idempotency_key
    );

    return v_resultado || jsonb_build_object('audit_log_id', v_audit_id);
  end if;

  if not p_confirmar then
    return jsonb_build_object(
      'success', false,
      'code', 'CONFIRMATION_REQUIRED',
      'message', 'Confirme explicitamente a exclusao do rascunho sem historico.',
      'ordem_id', p_ordem_id,
      'dependencies', v_dependencias
    );
  end if;

  if length(trim(coalesce(p_motivo, ''))) < 5 then
    return jsonb_build_object(
      'success', false,
      'code', 'REASON_REQUIRED',
      'message', 'Informe um motivo com pelo menos 5 caracteres.',
      'ordem_id', p_ordem_id
    );
  end if;

  select coalesce(jsonb_agg(to_jsonb(s) order by s.sequencia, s.id), '[]'::jsonb)
  into v_snapshot_operacoes
  from public.ordem_producao_operacoes s
  where s.empresa_id = p_empresa_id and s.ordem_id = p_ordem_id;

  select coalesce(jsonb_agg(to_jsonb(b) order by b.insumo_id, b.id), '[]'::jsonb)
  into v_snapshot_bom
  from public.ordem_producao_bom_itens b
  where b.empresa_id = p_empresa_id and b.ordem_id = p_ordem_id;

  v_resultado := jsonb_build_object(
    'success', true,
    'action', 'deleted_draft',
    'code', 'OP_DRAFT_DELETED',
    'message', 'Rascunho da Ordem de Producao excluido com auditoria.',
    'ordem_id', p_ordem_id,
    'numero_op', v_ordem.numero_op,
    'audit_log_id', v_audit_id
  );

  insert into public.audit_logs (
    id, tenant_id, entity_type, entity_id, action, module,
    original_record_id, performed_by, reason_code, reason_description,
    old_values, new_values, affected_records, metadata,
    idempotency_key
  ) values (
    v_audit_id, p_empresa_id, 'ordem_producao', p_ordem_id,
    'order_deleted', 'pcp', p_ordem_id, v_user_id,
    'draft_without_history', trim(p_motivo),
    to_jsonb(v_ordem), '{}'::jsonb,
    jsonb_build_object(
      'dependencies', v_dependencias,
      'snapshot_operacoes', v_snapshot_operacoes,
      'snapshot_bom', v_snapshot_bom
    ),
    jsonb_build_object('result', v_resultado), p_idempotency_key
  );

  -- Os snapshots de um rascunho sem historico sao removidos explicitamente,
  -- depois de copiados integralmente para a auditoria. Nunca por CASCADE.
  delete from public.ordem_producao_bom_itens
  where empresa_id = p_empresa_id and ordem_id = p_ordem_id;
  delete from public.ordem_producao_operacoes
  where empresa_id = p_empresa_id and ordem_id = p_ordem_id;

  perform set_config('app.safe_order_delete', p_ordem_id::text, true);
  delete from public.ordens_producao
  where id = p_ordem_id and empresa_id = p_empresa_id;

  return v_resultado;
end;
$$;

revoke all on function public.excluir_ordem_producao_segura(
  uuid, uuid, text, boolean, uuid
) from public, anon, authenticated;
grant execute on function public.excluir_ordem_producao_segura(
  uuid, uuid, text, boolean, uuid
) to authenticated;

-- A ponte antiga permanece apenas ate o frontend novo estar publicado.
-- Em bloqueios ela gera erro, pois o frontend antigo nao interpreta success=false.
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
  v_resultado jsonb;
begin
  v_resultado := public.excluir_ordem_producao_segura(
    p_empresa_id,
    p_ordem_id,
    p_motivo,
    true,
    gen_random_uuid()
  );

  if not coalesce((v_resultado ->> 'success')::boolean, false) then
    raise exception '%', coalesce(
      v_resultado ->> 'message',
      'A Ordem de Producao nao pode ser excluida.'
    ) using errcode = '23514';
  end if;

  return v_resultado;
end;
$$;

revoke all on function public.cancelar_ou_excluir_ordem_producao(
  uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.cancelar_ou_excluir_ordem_producao(
  uuid, uuid, text
) to authenticated;

notify pgrst, 'reload schema';

commit;
