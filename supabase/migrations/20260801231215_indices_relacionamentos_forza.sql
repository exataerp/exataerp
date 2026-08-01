create index if not exists fornecedor_insumos_fornecedor_id_idx
  on public.fornecedor_insumos (fornecedor_id);

create index if not exists funcionarios_setor_id_idx
  on public.funcionarios (setor_id);

create index if not exists funcionarios_turno_id_idx
  on public.funcionarios (turno_id)
  where turno_id is not null;

create index if not exists funcionarios_user_id_idx
  on public.funcionarios (user_id)
  where user_id is not null;

create index if not exists insumos_familia_id_idx
  on public.insumos (familia_id)
  where familia_id is not null;

create index if not exists maquinas_setor_id_idx
  on public.maquinas (setor_id)
  where setor_id is not null;

create index if not exists maquinas_turno_id_idx
  on public.maquinas (turno_id)
  where turno_id is not null;

create index if not exists operacoes_setor_id_idx
  on public.operacoes (setor_id)
  where setor_id is not null;

create index if not exists produtos_familia_id_idx
  on public.produtos (familia_id)
  where familia_id is not null;

create index if not exists saldo_estoque_local_id_idx
  on public.saldo_estoque (local_id)
  where local_id is not null;

create index if not exists setores_unidade_id_idx
  on public.setores (unidade_id)
  where unidade_id is not null;
