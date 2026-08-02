-- Reconcilia os dois locais duplicados criados pela primeira execução do seed
-- com codificação incorreta e atualiza o texto desnormalizado dos apontamentos.
-- A carga principal é reexecutada explicitamente em UTF-8 antes desta migration.

do $$
declare
  v_empresa_id uuid;
begin
  select id
    into v_empresa_id
  from public.empresas
  where nome = 'FORZA IMPLEMENTOS'
  limit 1;

  if v_empresa_id is null then
    raise exception 'Empresa FORZA IMPLEMENTOS não encontrada.';
  end if;

  if (select count(*) from public.empresas where nome = 'FORZA IMPLEMENTOS') <> 1 then
    raise exception 'A correção exige exatamente uma empresa FORZA IMPLEMENTOS.';
  end if;

  with pares as (
    select antigo.id as antigo_id, correto.id as correto_id
    from public.locais_estoque antigo
    join public.locais_estoque correto
      on correto.empresa_id = antigo.empresa_id
     and correto.nome in ('Estoque Intermediário', 'Área de Expedição')
    where antigo.empresa_id = v_empresa_id
      and antigo.id <> correto.id
      and (
        (correto.nome = 'Estoque Intermediário' and antigo.nome like 'Estoque Intermedi%')
        or
        (correto.nome = 'Área de Expedição' and antigo.nome like '%rea de Expedi%')
      )
  )
  update public.saldo_estoque saldo
  set local_id = pares.correto_id,
      updated_at = now()
  from pares
  where saldo.empresa_id = v_empresa_id
    and saldo.local_id = pares.antigo_id;

  with pares as (
    select antigo.id as antigo_id, correto.id as correto_id
    from public.locais_estoque antigo
    join public.locais_estoque correto
      on correto.empresa_id = antigo.empresa_id
     and correto.nome in ('Estoque Intermediário', 'Área de Expedição')
    where antigo.empresa_id = v_empresa_id
      and antigo.id <> correto.id
      and (
        (correto.nome = 'Estoque Intermediário' and antigo.nome like 'Estoque Intermedi%')
        or
        (correto.nome = 'Área de Expedição' and antigo.nome like '%rea de Expedi%')
      )
  )
  update public.movimentacoes_estoque movimento
  set local_id = pares.correto_id
  from pares
  where movimento.empresa_id = v_empresa_id
    and movimento.local_id = pares.antigo_id;

  delete from public.locais_estoque antigo
  using public.locais_estoque correto
  where antigo.empresa_id = v_empresa_id
    and correto.empresa_id = v_empresa_id
    and correto.nome in ('Estoque Intermediário', 'Área de Expedição')
    and antigo.id <> correto.id
    and (
      (correto.nome = 'Estoque Intermediário' and antigo.nome like 'Estoque Intermedi%')
      or
      (correto.nome = 'Área de Expedição' and antigo.nome like '%rea de Expedi%')
    );

  update public.apontamentos apontamento
  set operacao_nome = operacao.nome
  from public.operacoes operacao
  where apontamento.empresa_id = v_empresa_id
    and apontamento.operacao_id = operacao.id
    and operacao.empresa_id = v_empresa_id
    and operacao.dados_demonstracao
    and apontamento.observacao like 'SEED FORZA%'
    and apontamento.operacao_nome is distinct from operacao.nome;

  if (select count(*) from public.locais_estoque where empresa_id = v_empresa_id) <> 7 then
    raise exception 'A FORZA deve possuir exatamente sete locais de estoque após a reconciliação.';
  end if;

  if exists (
    select 1
    from public.apontamentos
    where empresa_id = v_empresa_id
      and observacao like 'SEED FORZA%'
      and operacao_nome ~ '[ÃÂ]'
  ) then
    raise exception 'Ainda existem nomes de operação com codificação inválida nos apontamentos da FORZA.';
  end if;
end;
$$;
