do $$
declare
  v_user_id uuid;
  v_empresa_id uuid;
  v_role_id uuid;
begin
  select p.user_id, p.empresa_id
    into v_user_id, v_empresa_id
  from public.perfis p
  where lower(p.email) = 'contatoexataerp@yahoo.com';

  if v_user_id is null or v_empresa_id is null then
    raise exception 'Conta teste da Exata ERP não encontrada.';
  end if;

  select r.id
    into v_role_id
  from public.roles r
  where r.name = 'system_manager';

  if v_role_id is null then
    raise exception 'Função system_manager não encontrada.';
  end if;

  update public.perfis
  set nome = 'Tiago Prado',
      status = 'ativo',
      updated_at = now()
  where user_id = v_user_id
    and empresa_id = v_empresa_id;

  update public.empresas
  set nome = 'FORZA IMPLEMENTOS',
      nome_fantasia = 'FORZA IMPLEMENTOS',
      admin_id = v_user_id
  where id = v_empresa_id;

  insert into public.user_roles (
    user_id,
    empresa_id,
    role_id,
    granted_by
  )
  values (
    v_user_id,
    v_empresa_id,
    v_role_id,
    v_user_id
  )
  on conflict (user_id, empresa_id, role_id) do nothing;

  update public.controle_acesso
  set nivel = 'admin',
      status = 'ativo',
      activated_at = coalesce(activated_at, now())
  where user_id = v_user_id
    and empresa_id = v_empresa_id;

  if not found then
    insert into public.controle_acesso (
      user_id,
      empresa_id,
      nivel,
      status,
      activated_at
    )
    values (
      v_user_id,
      v_empresa_id,
      'admin',
      'ativo',
      now()
    );
  end if;
end;
$$;
