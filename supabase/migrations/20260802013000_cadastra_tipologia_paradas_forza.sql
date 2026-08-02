-- Cadastra a tipologia de paradas de máquina fornecida pela FORZA IMPLEMENTOS.
-- A estrutura atual não possui coluna de código; por isso o código é preservado
-- no início do nome do motivo, mantendo a ordenação e as descrições duplicadas.

do $$
declare
  v_empresa_id uuid;
  v_grupo_id uuid;
  v_empresa_count integer;
  v_motivos_count integer;
begin
  select count(*)
    into v_empresa_count
  from public.empresas
  where nome = 'FORZA IMPLEMENTOS';

  if v_empresa_count <> 1 then
    raise exception 'Esperada exatamente uma empresa FORZA IMPLEMENTOS; encontradas %.', v_empresa_count;
  end if;

  select id
    into v_empresa_id
  from public.empresas
  where nome = 'FORZA IMPLEMENTOS';

  select id
    into v_grupo_id
  from public.excecao_grupos
  where empresa_id = v_empresa_id
    and lower(trim(nome)) = lower('Paradas de Máquina')
  order by created_at, id
  limit 1;

  if v_grupo_id is null then
    insert into public.excecao_grupos (empresa_id, nome)
    values (v_empresa_id, 'Paradas de Máquina')
    returning id into v_grupo_id;
  end if;

  with tipologia(codigo, descricao) as (values
    ('010', 'LIMPEZA MÁQUINA'),
    ('011', 'OPERANDO OUTRA MÁQUINA / DESLOCAMENTO OPERADOR'),
    ('012', 'FALTA DE PROGRAMAÇÃO (PCP)'),
    ('013', 'AUSENCIA DE OPERADOR - ABSENT.'),
    ('014', 'REUNIÃO/TREINAMENTO'),
    ('015', 'MANUT. AUTÔNOMA/PREVENTIVA'),
    ('016', 'MANUTENÇÃO CORRETIVA'),
    ('017', 'AGUARD. LIBERAÇÃO DA QUALIDADE'),
    ('018', 'MELHORIA NO POSTO DE TRABALHO'),
    ('019', 'FALHA DE PROJETO/DESENHO/PROCESSO'),
    ('020', 'SETUP'),
    ('021', 'AJUSTE DE PROGRAMA / NOVO PROGRAMA'),
    ('022', 'FALTA DE CONSUMÍVEIS'),
    ('023', 'AGUARDANDO EMPILHADEIRA'),
    ('024', 'AGUARDANDO PONTE ROLANTE'),
    ('025', 'ADEQUAÇÃO DE CHAPA (MATERIAL NÃO CONFORME)'),
    ('026', 'REPOSIÇÃO DE ÁGUA'),
    ('027', 'FALTA DE DEMANDA'),
    ('028', 'AGUARDANDO ABASTECIMENTO DE MATÉRIA PRIMA'),
    ('029', 'LIMPEZA DE PEÇAS'),
    ('030', 'AUXILIANDO OUTRO OPERADOR/MÁQUINA'),
    ('031', 'REPOSIÇÃO DE ÓLEO'),
    ('032', 'FALTA DE ENERGIA'),
    ('033', 'FALTA DE MATERIAL/MP'),
    ('034', 'BANHEIRO'),
    ('035', 'INICIALIZAÇÃO DE EQUIPAMENTO'),
    ('036', 'RETRABALHO'),
    ('037', 'REPOSIÇÃO DE ÓLEO'),
    ('038', 'CONFERIR QUANTIDADES E PEÇAS E FINALIZAR ORDEM'),
    ('039', 'MEDIR PEÇAS'),
    ('040', 'AGUARDANDO LIDER'),
    ('041', 'MOVIMENTAÇÃO DE MATERIAIS'),
    ('042', 'VIRANDO INSERTO'),
    ('043', 'FALTA DE AR NA REDE')
  )
  insert into public.excecao_subgrupos (empresa_id, grupo_id, nome)
  select v_empresa_id, v_grupo_id, t.codigo || ' — ' || t.descricao
  from tipologia t
  where not exists (
    select 1
    from public.excecao_subgrupos s
    where s.empresa_id = v_empresa_id
      and s.grupo_id = v_grupo_id
      and s.nome = t.codigo || ' — ' || t.descricao
  );

  with codigos(codigo) as (values
    ('010'), ('011'), ('012'), ('013'), ('014'), ('015'), ('016'), ('017'), ('018'), ('019'),
    ('020'), ('021'), ('022'), ('023'), ('024'), ('025'), ('026'), ('027'), ('028'), ('029'),
    ('030'), ('031'), ('032'), ('033'), ('034'), ('035'), ('036'), ('037'), ('038'), ('039'),
    ('040'), ('041'), ('042'), ('043')
  )
  select count(*)
    into v_motivos_count
  from codigos c
  where exists (
    select 1
    from public.excecao_subgrupos s
    where s.empresa_id = v_empresa_id
      and s.grupo_id = v_grupo_id
      and left(s.nome, 3) = c.codigo
  );

  if v_motivos_count <> 34 then
    raise exception 'A validação encontrou % de 34 códigos de parada.', v_motivos_count;
  end if;
end;
$$;
