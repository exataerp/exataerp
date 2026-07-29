create index if not exists operacoes_produto_id_idx
  on public.operacoes (produto_id);

create index if not exists operacoes_maquina_id_idx
  on public.operacoes (maquina_id);
