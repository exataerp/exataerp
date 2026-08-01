-- As duas costuradoras executam as operações de costura dos roteiros.
-- O vínculo N:N permite que o operador escolha qualquer um dos dois postos.
insert into public.operacao_postos_trabalho (
  empresa_id,
  operacao_id,
  maquina_id,
  ativo
)
select
  o.empresa_id,
  o.id,
  m.id,
  true
from public.operacoes o
join public.maquinas m
  on m.empresa_id = o.empresa_id
where lower(btrim(o.nome)) like 'costur%'
  and lower(btrim(coalesce(m.setor, ''))) = 'costura'
  and m.status = 'ativa'
  and m.codigo in ('HL 80x40', 'LM 80x120')
on conflict (empresa_id, operacao_id, maquina_id)
do update set ativo = excluded.ativo;
