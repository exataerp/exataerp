create or replace function public.upsert_private_auth_state(
  p_operation_id uuid,
  p_user_id uuid,
  p_username text,
  p_must_change_password boolean,
  p_expected_state_version bigint,
  p_correlation_id text
) returns table(credential_version bigint,state_version bigint)
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  s app_private.user_auth_state%rowtype;
  o app_private.identity_operations%rowtype;
begin
  select * into o
  from app_private.identity_operations
  where id=p_operation_id and status='pending'
  for update;
  if not found then raise exception 'operation conflict'; end if;

  if o.target_user_id is not null and o.target_user_id is distinct from p_user_id then
    raise exception 'operation target mismatch';
  end if;
  if o.operation_type in('create_user','create_tenant_admin') and o.username is distinct from p_username then
    raise exception 'operation username mismatch';
  end if;
  if not exists(
    select 1
    from public.perfis p
    join public.controle_acesso ca
      on ca.user_id=p.user_id and ca.empresa_id=p.empresa_id and ca.status='ativo'
    where p.user_id=p_user_id and p.empresa_id=o.empresa_id and p.status='ativo'
  ) then raise exception 'target tenant mismatch'; end if;
  if o.operation_type='create_tenant_admin' and not exists(
    select 1
    from public.v_user_roles vr
    where vr.user_id=p_user_id and vr.empresa_id=o.empresa_id and vr.role_name='system_manager'
  ) then raise exception 'administrator role mismatch'; end if;

  select * into s
  from app_private.user_auth_state
  where user_id=p_user_id
  for update;
  if found and p_expected_state_version is not null and s.state_version<>p_expected_state_version then
    raise exception 'state version conflict';
  end if;

  insert into app_private.user_auth_state(
    user_id,username,must_change_password,password_reset_required_at,password_reset_by
  ) values(
    p_user_id,p_username,p_must_change_password,
    case when p_must_change_password then statement_timestamp() end,
    case when p_must_change_password then o.actor_user_id end
  )
  on conflict(user_id) do update set
    username=coalesce(excluded.username,app_private.user_auth_state.username),
    must_change_password=excluded.must_change_password,
    password_changed_at=case
      when excluded.must_change_password then app_private.user_auth_state.password_changed_at
      else statement_timestamp()
    end,
    password_reset_required_at=excluded.password_reset_required_at,
    password_reset_by=excluded.password_reset_by,
    credential_version=app_private.user_auth_state.credential_version+1,
    state_version=app_private.user_auth_state.state_version+1,
    updated_at=statement_timestamp()
  returning * into s;

  update app_private.identity_operations as io set
    status='completed',
    target_user_id=p_user_id,
    result=case
      when o.operation_type='create_tenant_admin' then jsonb_build_object(
        'success',true,'empresa_id',o.empresa_id,'user_id',p_user_id,
        'username',p_username,'status','completed'
      )
      when o.operation_type='create_user' then jsonb_build_object(
        'success',true,'user_id',p_user_id,'username',p_username,
        'requires_password_change',true
      )
      else '{}'::jsonb
    end,
    state_version=io.state_version+1,
    updated_at=statement_timestamp()
  where io.id=o.id;

  insert into app_private.identity_audit_outbox(
    operation_id,event_type,actor_user_id,target_user_id,empresa_id,success,correlation_id
  ) values(
    o.id,o.operation_type,o.actor_user_id,p_user_id,o.empresa_id,true,p_correlation_id
  );
  return query select s.credential_version,s.state_version;
end
$$;

alter function public.upsert_private_auth_state(uuid,uuid,text,boolean,bigint,text) owner to postgres;
revoke all on function public.upsert_private_auth_state(uuid,uuid,text,boolean,bigint,text)
  from public,anon,authenticated;
grant execute on function public.upsert_private_auth_state(uuid,uuid,text,boolean,bigint,text)
  to service_role;
