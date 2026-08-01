-- Ajustes apontados pelos advisors após a publicação dos postos de trabalho.
-- Índices de FK aceleram joins e cascatas; políticas de escrita separadas
-- evitam políticas permissivas duplicadas para SELECT.

create index if not exists usuario_postos_trabalho_user_id_idx
  on public.usuario_postos_trabalho (user_id);
create index if not exists usuario_postos_trabalho_maquina_id_idx
  on public.usuario_postos_trabalho (maquina_id);
create index if not exists usuario_postos_trabalho_created_by_idx
  on public.usuario_postos_trabalho (created_by);

create index if not exists operacao_postos_trabalho_operacao_id_idx
  on public.operacao_postos_trabalho (operacao_id);
create index if not exists operacao_postos_trabalho_maquina_id_idx
  on public.operacao_postos_trabalho (maquina_id);

create index if not exists equipe_membros_equipe_id_idx
  on public.equipe_membros (equipe_id);
create index if not exists equipe_membros_user_id_idx
  on public.equipe_membros (user_id);

create index if not exists equipe_postos_trabalho_equipe_id_idx
  on public.equipe_postos_trabalho (equipe_id);
create index if not exists equipe_postos_trabalho_maquina_id_idx
  on public.equipe_postos_trabalho (maquina_id);

drop policy if exists "usuario_postos: gestor administra" on public.usuario_postos_trabalho;
create policy "usuario_postos: gestor insere" on public.usuario_postos_trabalho
for insert to authenticated
with check ((select private.eh_gestor_producao(empresa_id)));
create policy "usuario_postos: gestor atualiza" on public.usuario_postos_trabalho
for update to authenticated
using ((select private.eh_gestor_producao(empresa_id)))
with check ((select private.eh_gestor_producao(empresa_id)));
create policy "usuario_postos: gestor exclui" on public.usuario_postos_trabalho
for delete to authenticated
using ((select private.eh_gestor_producao(empresa_id)));

drop policy if exists "operacao_postos: gestor administra" on public.operacao_postos_trabalho;
create policy "operacao_postos: gestor insere" on public.operacao_postos_trabalho
for insert to authenticated
with check ((select private.eh_gestor_producao(empresa_id)));
create policy "operacao_postos: gestor atualiza" on public.operacao_postos_trabalho
for update to authenticated
using ((select private.eh_gestor_producao(empresa_id)))
with check ((select private.eh_gestor_producao(empresa_id)));
create policy "operacao_postos: gestor exclui" on public.operacao_postos_trabalho
for delete to authenticated
using ((select private.eh_gestor_producao(empresa_id)));

drop policy if exists "equipes: gestor administra" on public.equipes;
create policy "equipes: gestor insere" on public.equipes
for insert to authenticated
with check ((select private.eh_gestor_producao(empresa_id)));
create policy "equipes: gestor atualiza" on public.equipes
for update to authenticated
using ((select private.eh_gestor_producao(empresa_id)))
with check ((select private.eh_gestor_producao(empresa_id)));
create policy "equipes: gestor exclui" on public.equipes
for delete to authenticated
using ((select private.eh_gestor_producao(empresa_id)));

drop policy if exists "equipe_membros: gestor administra" on public.equipe_membros;
create policy "equipe_membros: gestor insere" on public.equipe_membros
for insert to authenticated
with check ((select private.eh_gestor_producao(empresa_id)));
create policy "equipe_membros: gestor atualiza" on public.equipe_membros
for update to authenticated
using ((select private.eh_gestor_producao(empresa_id)))
with check ((select private.eh_gestor_producao(empresa_id)));
create policy "equipe_membros: gestor exclui" on public.equipe_membros
for delete to authenticated
using ((select private.eh_gestor_producao(empresa_id)));

drop policy if exists "equipe_postos: gestor administra" on public.equipe_postos_trabalho;
create policy "equipe_postos: gestor insere" on public.equipe_postos_trabalho
for insert to authenticated
with check ((select private.eh_gestor_producao(empresa_id)));
create policy "equipe_postos: gestor atualiza" on public.equipe_postos_trabalho
for update to authenticated
using ((select private.eh_gestor_producao(empresa_id)))
with check ((select private.eh_gestor_producao(empresa_id)));
create policy "equipe_postos: gestor exclui" on public.equipe_postos_trabalho
for delete to authenticated
using ((select private.eh_gestor_producao(empresa_id)));

notify pgrst, 'reload schema';
