-- Validações automatizadas do seed FORZA IMPLEMENTOS.
-- A consulta deve retornar todas as linhas com ok = true.

with recursive empresa as (
  select id from public.empresas where nome = 'FORZA IMPLEMENTOS'
), arestas as (
  select b.produto_codigo as pai, i.codigo as filho
  from public.bom_itens b
  join public.insumos i
    on i.id = b.insumo_id
   and i.empresa_id = b.empresa_id
  where b.empresa_id = (select id from empresa)
    and exists (
      select 1
      from public.produtos p
      where p.empresa_id = b.empresa_id
        and p.codigo = i.codigo
    )
), arvore(raiz, no_atual, caminho, ciclo) as (
  select pai, filho, array[pai, filho]::text[], pai = filho
  from arestas
  union all
  select a.raiz, e.filho, a.caminho || e.filho, e.filho = any(a.caminho)
  from arvore a
  join arestas e on e.pai = a.no_atual
  where not a.ciclo
    and cardinality(a.caminho) < 10
), validacoes(ordem, validacao, esperado, obtido, ok) as (
  select 1, 'Uma empresa FORZA IMPLEMENTOS', '1', count(*)::text, count(*) = 1
  from public.empresas where nome = 'FORZA IMPLEMENTOS'

  union all
  select 2, 'Funcionários totais', '294', count(*)::text, count(*) = 294
  from public.funcionarios where empresa_id = (select id from empresa) and status = 'ativo'

  union all
  select 3, 'Funcionários produtivos', '235', count(*)::text, count(*) = 235
  from public.funcionarios f
  join public.setores s on s.id = f.setor_id
  where f.empresa_id = (select id from empresa) and s.produtivo and f.status = 'ativo'

  union all
  select 4, 'Funcionários administrativos e de apoio', '59', count(*)::text, count(*) = 59
  from public.funcionarios f
  join public.setores s on s.id = f.setor_id
  where f.empresa_id = (select id from empresa) and not s.produtivo and f.status = 'ativo'

  union all
  select 5, 'Soma de funcionários por setor', '294', count(*)::text, count(*) = 294
  from public.funcionarios f
  join public.setores s on s.id = f.setor_id and s.empresa_id = f.empresa_id
  where f.empresa_id = (select id from empresa)

  union all
  select 6, 'Itens ativos', '>= 5200', count(*)::text, count(*) >= 5200
  from public.insumos where empresa_id = (select id from empresa) and ativo

  union all
  select 7, 'Produtos fabricados sem roteiro', '0', count(*)::text, count(*) = 0
  from public.produtos p
  where p.empresa_id = (select id from empresa) and p.ativo
    and not exists (
      select 1 from public.operacoes o
      where o.empresa_id = p.empresa_id and o.produto_id = p.id and o.ativo
    )

  union all
  select 8, 'Produtos acabados sem BOM', '0', count(*)::text, count(*) = 0
  from public.produtos p
  where p.empresa_id = (select id from empresa) and p.tipo_item = 'produto_acabado'
    and not exists (
      select 1 from public.bom_itens b
      where b.empresa_id = p.empresa_id and b.produto_codigo = p.codigo
    )

  union all
  select 9, 'Ciclos nas estruturas', '0', count(*)::text, count(*) = 0
  from arvore where ciclo

  union all
  select 10, 'Operações sem setor', '0', count(*)::text, count(*) = 0
  from public.operacoes where empresa_id = (select id from empresa) and setor_id is null

  union all
  select 11, 'Postos sem setor', '0', count(*)::text, count(*) = 0
  from public.maquinas where empresa_id = (select id from empresa) and setor_id is null

  union all
  select 12, 'Tempos padrão inválidos', '0', count(*)::text, count(*) = 0
  from public.operacoes
  where empresa_id = (select id from empresa) and (tempo <= 0 or setup_time < 0)

  union all
  select 13, 'Sequências duplicadas nos roteiros', '0', count(*)::text, count(*) = 0
  from (
    select produto_id, ordem
    from public.operacoes
    where empresa_id = (select id from empresa)
    group by produto_id, ordem
    having count(*) > 1
  ) duplicadas

  union all
  select 14, 'Operações com máquina inexistente', '0', count(*)::text, count(*) = 0
  from public.operacoes o
  left join public.maquinas m on m.id = o.maquina_id and m.empresa_id = o.empresa_id
  where o.empresa_id = (select id from empresa) and (o.maquina_id is null or m.id is null)

  union all
  select 15, 'Funcionários com setor inexistente', '0', count(*)::text, count(*) = 0
  from public.funcionarios f
  left join public.setores s on s.id = f.setor_id and s.empresa_id = f.empresa_id
  where f.empresa_id = (select id from empresa) and s.id is null

  union all
  select 16, 'Itens comprados com roteiro produtivo', '0', count(*)::text, count(*) = 0
  from public.insumos i
  join public.produtos p on p.empresa_id = i.empresa_id and p.codigo = i.codigo
  where i.empresa_id = (select id from empresa)
    and i.tipo in ('componente_comprado','materia_prima','embalagem','consumivel')
    and exists (select 1 from public.operacoes o where o.empresa_id=p.empresa_id and o.produto_id=p.id)

  union all
  select 17, 'Operações sem vínculo com posto', '0', count(*)::text, count(*) = 0
  from public.operacoes o
  where o.empresa_id = (select id from empresa)
    and not exists (
      select 1 from public.operacao_postos_trabalho opt
      where opt.empresa_id = o.empresa_id and opt.operacao_id = o.id and opt.ativo
    )

  union all
  select 18, 'Setores produtivos sem trabalho disponível', '0', count(*)::text, count(*) = 0
  from public.setores s
  where s.empresa_id = (select id from empresa) and s.produtivo
    and not exists (
      select 1
      from public.maquinas m
      join public.operacao_postos_trabalho opt
        on opt.empresa_id = m.empresa_id and opt.maquina_id = m.id and opt.ativo
      join public.operacoes o
        on o.empresa_id = opt.empresa_id and o.id = opt.operacao_id and o.ativo
      where m.empresa_id = s.empresa_id and m.setor_id = s.id
    )

  union all
  select 19, 'Dados demonstrativos fora da FORZA', '0', count(*)::text, count(*) = 0
  from (
    select empresa_id from public.produtos where dados_demonstracao
    union all select empresa_id from public.insumos where dados_demonstracao
    union all select empresa_id from public.maquinas where dados_demonstracao
    union all select empresa_id from public.funcionarios where dados_demonstracao
    union all select empresa_id from public.ordens_producao where dados_demonstracao
  ) demo
  where demo.empresa_id <> (select id from empresa)

  union all
  select 20, 'Chaves duplicadas do seed', '0', count(*)::text, count(*) = 0
  from (
    select codigo from public.produtos where empresa_id=(select id from empresa) group by codigo having count(*)>1
    union all select codigo from public.insumos where empresa_id=(select id from empresa) group by codigo having count(*)>1
    union all select codigo from public.maquinas where empresa_id=(select id from empresa) group by codigo having count(*)>1
    union all select matricula from public.funcionarios where empresa_id=(select id from empresa) group by matricula having count(*)>1
    union all select numero_op from public.ordens_producao where empresa_id=(select id from empresa) group by numero_op having count(*)>1
  ) duplicadas

  union all
  select 21, 'Equipamentos produtivos', '67', count(*)::text, count(*) = 67
  from public.maquinas
  where empresa_id = (select id from empresa) and eh_equipamento and dados_demonstracao

  union all
  select 22, 'Ordens demonstrativas', '42', count(*)::text, count(*) = 42
  from public.ordens_producao
  where empresa_id = (select id from empresa) and dados_demonstracao

  union all
  select 23, 'Fornecedores fictícios', '20', count(*)::text, count(*) = 20
  from public.fornecedores
  where empresa_id = (select id from empresa) and dados_demonstracao
)
select ordem, validacao, esperado, obtido, ok
from validacoes
order by ordem;
