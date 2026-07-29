-- A política anterior consultava public.user_roles dentro da própria política,
-- causando "infinite recursion detected in policy for relation user_roles".
-- O helper privado já valida administradores ativos e limita o acesso à empresa.
drop policy if exists "user_roles_select_own" on public.user_roles;
drop policy if exists "user_roles_select_scoped" on public.user_roles;

create policy "user_roles_select_scoped"
on public.user_roles
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select private.pode_gerenciar_perfil(empresa_id))
);

-- A view deve respeitar as políticas das tabelas-base.
alter view public.v_user_roles set (security_invoker = true);
