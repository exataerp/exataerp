-- Indices de cobertura para as FKs introduzidas/reforcadas pela migration de
-- integridade. As tabelas ainda sao pequenas, portanto a criacao transacional
-- evita a complexidade de CREATE INDEX CONCURRENTLY sem gerar lock prolongado.

begin;

set local lock_timeout = '3s';
set local statement_timeout = '120s';

create index if not exists apontamento_pausas_apontamento_id_idx
  on public.apontamento_pausas (apontamento_id);

create index if not exists apontamentos_empresa_maquina_fk_idx
  on public.apontamentos (empresa_id, maquina_id);

create index if not exists apontamentos_empresa_operacao_fk_idx
  on public.apontamentos (empresa_id, operacao_id);

create index if not exists ordens_producao_empresa_produto_fk_idx
  on public.ordens_producao (empresa_id, produto_id);

create index if not exists ordem_producao_operacoes_ordem_id_fk_idx
  on public.ordem_producao_operacoes (ordem_id);

create index if not exists ordem_producao_operacoes_produto_id_fk_idx
  on public.ordem_producao_operacoes (produto_id);

create index if not exists ordem_producao_operacoes_operacao_id_fk_idx
  on public.ordem_producao_operacoes (operacao_id);

create index if not exists ordem_producao_operacoes_maquina_id_fk_idx
  on public.ordem_producao_operacoes (maquina_id)
  where maquina_id is not null;

create index if not exists ordem_producao_bom_itens_ordem_id_fk_idx
  on public.ordem_producao_bom_itens (ordem_id);

create index if not exists ordem_producao_bom_itens_produto_id_fk_idx
  on public.ordem_producao_bom_itens (produto_id);

create index if not exists ordem_producao_bom_itens_insumo_id_fk_idx
  on public.ordem_producao_bom_itens (insumo_id);

commit;
