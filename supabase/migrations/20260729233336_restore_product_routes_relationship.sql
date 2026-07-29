alter table public.produtos
  add constraint produtos_empresa_id_codigo_key
  unique (empresa_id, codigo);

alter table public.operacoes
  add constraint operacoes_produto_id_fkey
  foreign key (produto_id)
  references public.produtos(id)
  on delete cascade;

alter table public.operacoes
  add constraint operacoes_maquina_id_fkey
  foreign key (maquina_id)
  references public.maquinas(id)
  on delete set null;

create index if not exists operacoes_empresa_produto_ordem_idx
  on public.operacoes (empresa_id, produto_id, ordem);

notify pgrst, 'reload schema';
