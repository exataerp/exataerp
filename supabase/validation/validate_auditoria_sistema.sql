-- Execute depois de aplicar as migrations. Este arquivo valida o contrato de
-- segurança sem alterar dados operacionais.

do $$
declare
  v_missing text[] := '{}';
begin
  if to_regclass('public.audit_logs') is null then
    v_missing := array_append(v_missing, 'table:audit_logs');
  end if;

  if to_regprocedure('public.listar_auditoria_sistema(uuid,integer,integer,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text,text,text,text,text,text,text)') is null then
    v_missing := array_append(v_missing, 'rpc:listar_auditoria_sistema');
  end if;

  if to_regprocedure('public.obter_detalhes_auditoria(uuid,uuid)') is null then
    v_missing := array_append(v_missing, 'rpc:obter_detalhes_auditoria');
  end if;

  if to_regprocedure('public.estornar_apontamento_auditoria(uuid,uuid,text,text,uuid,inet,text)') is null then
    v_missing := array_append(v_missing, 'rpc:estornar_apontamento_auditoria');
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'audit_logs_immutable' and not tgisinternal
  ) then
    v_missing := array_append(v_missing, 'trigger:audit_logs_immutable');
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'apontamentos_bloquear_delete' and not tgisinternal
  ) then
    v_missing := array_append(v_missing, 'trigger:apontamentos_bloquear_delete');
  end if;

  if not exists (
    select 1
    from public.roles r
    join public.role_permissions rp on rp.role_id = r.id
    where r.name = 'system_manager'
      and rp.permission_code = 'auditoria.estornar'
  ) then
    v_missing := array_append(v_missing, 'permission:auditoria.estornar');
  end if;

  if cardinality(v_missing) > 0 then
    raise exception 'Validacao da auditoria falhou: %', array_to_string(v_missing, ', ');
  end if;
end;
$$;

select
  c.relrowsecurity as rls_enabled,
  exists (
    select 1 from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'audit_logs'
      and p.policyname = 'auditoria: autorizado visualiza'
  ) as select_policy_exists
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'audit_logs';
