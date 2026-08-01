-- Seed industrial completo e idempotente da empresa FORZA IMPLEMENTOS.
-- Execute somente depois da migration estrutura_industrial_forza.

set statement_timeout = '0';
set lock_timeout = '10s';

begin;

drop table if exists _forza_context;
create temporary table _forza_context on commit drop as
select e.id as empresa_id, e.admin_id
from public.empresas e
where e.nome = 'FORZA IMPLEMENTOS';

do $$
begin
  if (select count(*) from _forza_context) <> 1 then
    raise exception 'O seed exige exatamente uma empresa chamada FORZA IMPLEMENTOS.';
  end if;
end;
$$;

-- 1. Empresa, unidade, turnos e setores
update public.empresas e
set razao_social = 'Forza Implementos Rodoviários Ltda.',
    nome_fantasia = 'FORZA IMPLEMENTOS',
    segmento = 'Indústria metalúrgica de componentes para implementos rodoviários',
    num_funcionarios = '294',
    funcionarios_producao = 235,
    funcionarios_apoio = 59,
    percentual_produtivo = 79.93,
    regime_producao = 'Fabricação própria, verticalizada, sob estoque e encomenda',
    tipo_producao = 'Fabricação discreta',
    pais = 'Brasil',
    estado = 'RS',
    cidade = 'Caxias do Sul',
    moeda = 'BRL',
    idioma = 'pt-BR',
    timezone = 'America/Sao_Paulo',
    cnpj = 'DEMO-CNPJ-00.000.000/0001-00',
    endereco = 'Avenida Demonstração Industrial, 1000 - Distrito Industrial - CEP 95000-000',
    telefone = '(54) 0000-0000',
    email = 'contato@forza-implementos.example',
    tempo_padrao = 8,
    unidade_tempo = 'hours',
    onboarding_completed = true,
    status = 'ativo'
from _forza_context ctx
where e.id = ctx.empresa_id;

insert into public.unidades_empresa (
  empresa_id, codigo, nome, descricao, tipo, principal,
  pais, estado, cidade, endereco, ativo
)
select ctx.empresa_id, 'UNI-IND-01', 'Unidade Industrial',
       'Unidade fabril de demonstração da FORZA IMPLEMENTOS.',
       'industrial', true, 'Brasil', 'RS', 'Caxias do Sul',
       'Avenida Demonstração Industrial, 1000 - Distrito Industrial', true
from _forza_context ctx
on conflict (empresa_id, codigo) do update
set nome = excluded.nome,
    descricao = excluded.descricao,
    tipo = excluded.tipo,
    principal = excluded.principal,
    pais = excluded.pais,
    estado = excluded.estado,
    cidade = excluded.cidade,
    endereco = excluded.endereco,
    ativo = excluded.ativo,
    updated_at = now();

insert into public.turnos (empresa_id, nome, hora_inicio, hora_fim, dias_semana, ativo)
select ctx.empresa_id, turno.nome, turno.inicio, turno.fim, '{1,2,3,4,5}'::text[], true
from _forza_context ctx
cross join (values
  ('Turno 1', '07:00', '16:48'),
  ('Turno 2', '16:48', '02:24')
) as turno(nome, inicio, fim)
on conflict (empresa_id, nome) do update
set hora_inicio = excluded.hora_inicio,
    hora_fim = excluded.hora_fim,
    dias_semana = excluded.dias_semana,
    ativo = excluded.ativo;

with unidade as (
  select u.id, u.empresa_id
  from public.unidades_empresa u
  join _forza_context ctx on ctx.empresa_id = u.empresa_id
  where u.codigo = 'UNI-IND-01'
), dados(codigo, nome, descricao, tipo, centro_custo, capacidade, produtivo) as (values
  ('CORTE', 'Corte de chapas', 'Corte laser, plasma e preparação de chapas.', 'produtivo', 'CC-100', 32::numeric, true),
  ('SERRA', 'Serra de tubos e barras', 'Corte de tubos, barras e perfis metálicos.', 'produtivo', 'CC-110', 48::numeric, true),
  ('PRENSA', 'Prensas', 'Estampagem, conformação, furação e endireitamento.', 'produtivo', 'CC-120', 64::numeric, true),
  ('DOBRA', 'Dobra', 'Dobra, calandragem e conferência dimensional.', 'produtivo', 'CC-130', 16::numeric, true),
  ('SOLDA', 'Soldagem', 'Soldagem manual e robotizada de conjuntos.', 'produtivo', 'CC-140', 88::numeric, true),
  ('USIN', 'Usinagem', 'Torneamento, fresamento e centros de usinagem CNC.', 'produtivo', 'CC-150', 272::numeric, true),
  ('MONT', 'Montagem', 'Pré-montagem, montagem mecânica e testes funcionais.', 'produtivo', 'CC-160', 48::numeric, true),
  ('ALMOX', 'Almoxarifado', 'Recebimento, armazenagem e abastecimento de linha.', 'produtivo', 'CC-170', 16::numeric, true),
  ('EXP', 'Expedição', 'Embalagem, separação, carregamento e volumes.', 'produtivo', 'CC-180', 16::numeric, true),
  ('QUAL', 'Qualidade', 'Inspeções de recebimento, processo e final.', 'produtivo', 'CC-190', 24::numeric, true),
  ('FORJA', 'Forja', 'Aquecimento, forjamento, prensagem e resfriamento.', 'produtivo', 'CC-195', 16::numeric, true),
  ('DIR', 'Diretoria', 'Gestão executiva da unidade.', 'administrativo', 'CC-200', 24::numeric, false),
  ('ENG', 'Engenharia', 'Engenharia de produto e desenvolvimento.', 'apoio', 'CC-210', 64::numeric, false),
  ('PROC', 'Processos', 'Engenharia de processos e melhoria contínua.', 'apoio', 'CC-220', 40::numeric, false),
  ('PCP', 'PCP', 'Planejamento, programação e controle da produção.', 'apoio', 'CC-230', 56::numeric, false),
  ('COMP', 'Compras', 'Suprimentos e desenvolvimento de fornecedores.', 'administrativo', 'CC-240', 40::numeric, false),
  ('COMER', 'Comercial', 'Vendas e relacionamento com clientes.', 'administrativo', 'CC-250', 56::numeric, false),
  ('FIN', 'Financeiro', 'Controladoria, contas e custos.', 'administrativo', 'CC-260', 40::numeric, false),
  ('RH', 'Recursos Humanos', 'Gestão de pessoas e desenvolvimento.', 'administrativo', 'CC-270', 32::numeric, false),
  ('TI', 'Tecnologia da Informação', 'Infraestrutura, sistemas e suporte.', 'apoio', 'CC-280', 24::numeric, false),
  ('MANUT', 'Manutenção', 'Manutenção mecânica, elétrica e utilidades.', 'apoio', 'CC-290', 40::numeric, false),
  ('SEGT', 'Segurança do Trabalho', 'Saúde, segurança e prevenção.', 'apoio', 'CC-300', 24::numeric, false),
  ('LOGADM', 'Logística administrativa', 'Transportes, documentação e apoio logístico.', 'apoio', 'CC-310', 32::numeric, false)
)
insert into public.setores (
  empresa_id, unidade_id, codigo, nome, descricao, tipo,
  centro_custo, capacidade_horas_dia, produtivo, ativo
)
select u.empresa_id, u.id, d.codigo, d.nome, d.descricao, d.tipo,
       d.centro_custo, d.capacidade, d.produtivo, true
from unidade u
cross join dados d
on conflict (empresa_id, codigo) do update
set unidade_id = excluded.unidade_id,
    nome = excluded.nome,
    descricao = excluded.descricao,
    tipo = excluded.tipo,
    centro_custo = excluded.centro_custo,
    capacidade_horas_dia = excluded.capacidade_horas_dia,
    produtivo = excluded.produtivo,
    ativo = excluded.ativo,
    updated_at = now();

-- 2. Famílias de produto
with dados(codigo, nome) as (values
  ('EIX-CAM', 'Eixos para caminhões'),
  ('EIX-ONI', 'Eixos para ônibus'),
  ('EIX-AGR', 'Eixos para máquinas agrícolas'),
  ('EIX-CAR', 'Eixos para carretas e semirreboques'),
  ('RES-AR', 'Reservatórios de ar'),
  ('SUS-MEC', 'Suspensões mecânicas'),
  ('SUS-PNE', 'Suspensões pneumáticas'),
  ('SUS-CAM', 'Suspensões para caminhões'),
  ('SUS-CAR', 'Suspensões para carretas'),
  ('SUSP-EIX', 'Suspensores de eixo'),
  ('TRV-CON', 'Travas para contêineres'),
  ('SUP-SUS', 'Suportes de suspensão'),
  ('BRA-SUS', 'Braços de suspensão'),
  ('BAL', 'Balancins'),
  ('MAN', 'Mancais'),
  ('PIN', 'Pinos'),
  ('BUC', 'Buchas'),
  ('CUB', 'Cubos e conjuntos de roda'),
  ('FLA', 'Flanges'),
  ('TRA', 'Travessas'),
  ('SUP-CHA', 'Suportes de chassi'),
  ('CHA-REF', 'Chapas de reforço'),
  ('CMP-SOL', 'Componentes soldados'),
  ('CMP-USI', 'Componentes usinados'),
  ('CMP-FOR', 'Componentes forjados'),
  ('CJ-MON', 'Conjuntos montados para a parte inferior do chassi'),
  ('REP', 'Peças de reposição'),
  ('KIT', 'Kits de montagem'),
  ('SUB-EST', 'Subconjuntos estruturais'),
  ('CMP-DIV', 'Componentes diversos para implementos rodoviários')
)
insert into public.familias_produto (empresa_id, codigo, nome, descricao, ativo)
select ctx.empresa_id, d.codigo, d.nome,
       'Família industrial demonstrativa: ' || d.nome || '.', true
from _forza_context ctx
cross join dados d
on conflict (empresa_id, codigo) do update
set nome = excluded.nome,
    descricao = excluded.descricao,
    ativo = excluded.ativo,
    updated_at = now();

-- 3. Funcionários fictícios (235 produtivos + 59 administrativos/apoio)
with distribuicao(ordem, setor_codigo, quantidade, produtivo) as (values
  (1, 'CORTE', 15, true), (2, 'SERRA', 14, true), (3, 'PRENSA', 18, true),
  (4, 'DOBRA', 10, true), (5, 'SOLDA', 42, true), (6, 'USIN', 60, true),
  (7, 'MONT', 30, true), (8, 'ALMOX', 14, true), (9, 'EXP', 10, true),
  (10, 'QUAL', 12, true), (11, 'FORJA', 10, true),
  (12, 'DIR', 3, false), (13, 'ENG', 8, false), (14, 'PROC', 5, false),
  (15, 'PCP', 7, false), (16, 'COMP', 5, false), (17, 'COMER', 7, false),
  (18, 'FIN', 5, false), (19, 'RH', 4, false), (20, 'TI', 3, false),
  (21, 'MANUT', 5, false), (22, 'SEGT', 3, false), (23, 'LOGADM', 4, false)
), base as (
  select d.*, gs as local_n,
         row_number() over (order by d.ordem, gs) as n
  from distribuicao d
  cross join lateral generate_series(1, d.quantidade) gs
), nomes as (
  select b.*,
    (array[
      'Aline','Bruno','Camila','Diego','Elisa','Fábio','Gabriela','Henrique','Isabela','João',
      'Karina','Leandro','Marina','Nicolas','Olívia','Paulo','Queila','Rafael','Sabrina','Thiago',
      'Úrsula','Vinícius','Wesley','Yara','Adriana','Caio','Débora','Eduardo','Fernanda','Gustavo',
      'Helena','Igor','Jéssica','Lucas','Mônica','Natália','Otávio','Patrícia','Renato','Simone',
      'Tadeu','Valéria','William','Alice','César','Denise','Ernesto','Flávia','Hugo','Lívia'
    ])[((b.n - 1) % 50) + 1] || ' ' ||
    (array[
      'Monteiro Valença','Campos Serafim','Nogueira Bastos',
      'Vieira Amaral','Freitas Teles','Macedo Fontoura'
    ])[((b.n - 1) / 50) + 1] as nome_ficticio
  from base b
), cargos as (
  select n.*,
    case
      when n.produtivo and n.local_n = 1 then 'Supervisor de Produção'
      when n.produtivo and n.local_n <= 3 then 'Líder de Produção'
      when n.setor_codigo = 'CORTE' then case when n.local_n % 4 = 0 then 'Operador de plasma' else 'Operador de corte laser' end
      when n.setor_codigo = 'SERRA' then 'Operador de serra'
      when n.setor_codigo = 'PRENSA' then 'Operador de prensa'
      when n.setor_codigo = 'DOBRA' then 'Operador de dobradeira'
      when n.setor_codigo = 'SOLDA' then case when n.local_n % 5 = 0 then 'Operador de robô de solda' else 'Soldador' end
      when n.setor_codigo = 'USIN' then case when n.local_n % 7 = 0 then 'Preparador de máquinas' when n.local_n % 3 = 0 then 'Operador de centro de usinagem' else 'Torneiro CNC' end
      when n.setor_codigo = 'MONT' then 'Montador'
      when n.setor_codigo = 'ALMOX' then 'Almoxarife'
      when n.setor_codigo = 'EXP' then 'Expedidor'
      when n.setor_codigo = 'QUAL' then 'Inspetor de qualidade'
      when n.setor_codigo = 'FORJA' then 'Operador de forja'
      when n.local_n = 1 and n.setor_codigo = 'DIR' then 'Diretor industrial'
      when n.local_n = 1 then 'Coordenador de ' || n.setor_codigo
      when n.setor_codigo = 'ENG' then 'Engenheiro de produto'
      when n.setor_codigo = 'PROC' then 'Analista de processos'
      when n.setor_codigo = 'PCP' then 'Analista de PCP'
      when n.setor_codigo = 'COMP' then 'Comprador'
      when n.setor_codigo = 'COMER' then 'Analista comercial'
      when n.setor_codigo = 'FIN' then 'Analista financeiro'
      when n.setor_codigo = 'RH' then 'Analista de recursos humanos'
      when n.setor_codigo = 'TI' then 'Analista de sistemas'
      when n.setor_codigo = 'MANUT' then 'Técnico de manutenção'
      when n.setor_codigo = 'SEGT' then 'Técnico de segurança do trabalho'
      else 'Analista de logística'
    end as cargo_gerado
  from nomes n
)
insert into public.funcionarios (
  empresa_id, matricula, nome, setor_id, cargo, funcao, turno_id,
  status, data_admissao, email, acesso_sistema, dados_demonstracao
)
select ctx.empresa_id,
       'FZ-' || lpad(c.n::text, 4, '0'),
       c.nome_ficticio,
       s.id,
       c.cargo_gerado,
       c.cargo_gerado,
       t.id,
       'ativo',
       date '2017-01-02' + (((c.n * 17) % 3000)::integer),
       'fz' || lpad(c.n::text, 4, '0') || '@forza-implementos.example',
       (c.cargo_gerado like 'Supervisor%' or c.cargo_gerado like 'Líder%' or c.setor_codigo in ('PCP','QUAL','ALMOX','MANUT')),
       true
from cargos c
cross join _forza_context ctx
join public.setores s on s.empresa_id = ctx.empresa_id and s.codigo = c.setor_codigo
join public.turnos t on t.empresa_id = ctx.empresa_id
  and t.nome = case when c.produtivo and c.local_n % 2 = 0 then 'Turno 2' else 'Turno 1' end
on conflict (empresa_id, matricula) do update
set nome = excluded.nome,
    setor_id = excluded.setor_id,
    cargo = excluded.cargo,
    funcao = excluded.funcao,
    turno_id = excluded.turno_id,
    status = excluded.status,
    data_admissao = excluded.data_admissao,
    email = excluded.email,
    acesso_sistema = excluded.acesso_sistema,
    dados_demonstracao = true,
    updated_at = now();

-- 4. Máquinas, equipamentos e postos de trabalho
with recursos(codigo, nome, setor_codigo, tipo_recurso, eh_equipamento, capacidade, setup, taxa, eficiencia) as (
  select 'LASER-01', 'Máquina laser para corte de chapas', 'CORTE', 'corte_laser', true, 8::numeric, 25::numeric, 420::numeric, 91::numeric
  union all select 'PLASMA-' || lpad(gs::text,2,'0'), 'Máquina plasma ' || lpad(gs::text,2,'0'), 'CORTE', 'corte_plasma', true, 8, 20, 260, 87 from generate_series(1,3) gs
  union all select 'SERRA-' || lpad(gs::text,2,'0'), 'Serra-fita ' || lpad(gs::text,2,'0'), 'SERRA', 'serra_fita', true, 8, 12, 145, 88 from generate_series(1,6) gs
  union all select 'PRENSA-' || lpad(gs::text,2,'0'), 'Prensa hidráulica ' || lpad(gs::text,2,'0'), 'PRENSA', 'prensa', true, 8, 28, 210, 86 from generate_series(1,8) gs
  union all select 'DOBRA-' || lpad(gs::text,2,'0'), 'Dobradeira CNC ' || lpad(gs::text,2,'0'), 'DOBRA', 'dobradeira', true, 8, 24, 280, 90 from generate_series(1,2) gs
  union all select 'ROBO-SOLDA-' || lpad(gs::text,2,'0'), 'Robô de solda ' || lpad(gs::text,2,'0'), 'SOLDA', 'robo_solda', true, 8, 35, 390, 92 from generate_series(1,3) gs
  union all select 'BANC-SOLDA-' || lpad(gs::text,2,'0'), 'Bancada de soldagem manual ' || lpad(gs::text,2,'0'), 'SOLDA', 'soldagem_manual', true, 8, 10, 135, 84 from generate_series(1,8) gs
  union all select 'TORNO-CNC-' || lpad(gs::text,2,'0'), 'Torno CNC ' || lpad(gs::text,2,'0'), 'USIN', 'torno_cnc', true, 8, 45, 330, 89 from generate_series(1,27) gs
  union all select 'CENTRO-USI-' || lpad(gs::text,2,'0'), 'Centro de usinagem ' || lpad(gs::text,2,'0'), 'USIN', 'centro_usinagem', true, 8, 60, 480, 90 from generate_series(1,7) gs
  union all select 'FORNO-FORJA-01', 'Forno de forja', 'FORJA', 'forno_forja', true, 8, 90, 520, 86
  union all select 'PRENSA-FORJA-01', 'Prensa de forja', 'FORJA', 'prensa_forja', true, 8, 75, 610, 87
  union all select 'MONT-' || lpad(gs::text,2,'0'), 'Bancada de montagem ' || lpad(gs::text,2,'0'), 'MONT', 'posto_montagem', false, 8, 8, 95, 88 from generate_series(1,6) gs
  union all select * from (values
    ('QUAL-REC-01','Inspeção de recebimento','QUAL','posto_qualidade',false,8::numeric,5::numeric,110::numeric,92::numeric),
    ('QUAL-PROC-01','Inspeção de processo','QUAL','posto_qualidade',false,8,5,110,92),
    ('QUAL-FINAL-01','Inspeção final','QUAL','posto_qualidade',false,8,5,110,92),
    ('ALMOX-REC-01','Recebimento de materiais','ALMOX','posto_logistico',false,8,5,80,90),
    ('ALMOX-SEP-01','Separação de materiais','ALMOX','posto_logistico',false,8,5,80,90),
    ('EMB-01','Embalagem de conjuntos','MONT','posto_embalagem',false,8,5,75,90),
    ('EXP-01','Expedição e carregamento','EXP','posto_expedicao',false,8,5,85,90)
  ) p(codigo,nome,setor_codigo,tipo_recurso,eh_equipamento,capacidade,setup,taxa,eficiencia)
)
insert into public.maquinas (
  empresa_id, user_id, codigo, nome, setor, setor_id, tipo_recurso,
  eh_equipamento, capacidade_diaria, tempo_setup_padrao, status,
  observacao, turno_id, taxa_horaria, eficiencia_padrao,
  tempo_disponivel_minutos, calendario, dados_demonstracao
)
select ctx.empresa_id, ctx.admin_id, r.codigo, r.nome, s.nome, s.id, r.tipo_recurso,
       r.eh_equipamento, r.capacidade, r.setup, 'ativa',
       'Recurso industrial fictício para demonstração.', t.id, r.taxa, r.eficiencia,
       960, '{"dias":[1,2,3,4,5],"turnos":["Turno 1","Turno 2"]}'::jsonb, true
from recursos r
cross join _forza_context ctx
join public.setores s on s.empresa_id = ctx.empresa_id and s.codigo = r.setor_codigo
join public.turnos t on t.empresa_id = ctx.empresa_id and t.nome = 'Turno 1'
on conflict (empresa_id, codigo) do update
set nome = excluded.nome,
    setor = excluded.setor,
    setor_id = excluded.setor_id,
    tipo_recurso = excluded.tipo_recurso,
    eh_equipamento = excluded.eh_equipamento,
    capacidade_diaria = excluded.capacidade_diaria,
    tempo_setup_padrao = excluded.tempo_setup_padrao,
    status = excluded.status,
    observacao = excluded.observacao,
    turno_id = excluded.turno_id,
    taxa_horaria = excluded.taxa_horaria,
    eficiencia_padrao = excluded.eficiencia_padrao,
    tempo_disponivel_minutos = excluded.tempo_disponivel_minutos,
    calendario = excluded.calendario,
    dados_demonstracao = true;

insert into public.usuario_postos_trabalho (empresa_id, user_id, maquina_id, created_by)
select ctx.empresa_id, ctx.admin_id, m.id, ctx.admin_id
from _forza_context ctx
join public.maquinas m on m.empresa_id = ctx.empresa_id and m.dados_demonstracao
where ctx.admin_id is not null
on conflict (empresa_id, user_id, maquina_id) do nothing;

-- 5. Locais de estoque
insert into public.locais_estoque (empresa_id, nome, descricao)
select ctx.empresa_id, l.nome, l.descricao
from _forza_context ctx
cross join (values
  ('Almoxarifado de Chapas','Chapas e blanks metálicos.'),
  ('Almoxarifado de Tubos e Barras','Tubos, barras, perfis e eixos brutos.'),
  ('Almoxarifado de Componentes','Componentes comprados e itens de fixação.'),
  ('Estoque Intermediário','Subconjuntos e componentes fabricados.'),
  ('Estoque de Produtos Acabados','Produtos liberados para venda.'),
  ('Área de Expedição','Volumes separados e prontos para carregamento.'),
  ('Quarentena da Qualidade','Materiais aguardando inspeção ou decisão.')
) l(nome,descricao)
on conflict (empresa_id, nome) do update
set descricao = excluded.descricao;

-- 6. Produtos fabricados: 250 PA + 550 SC + 2.700 CF
with familias as (
  select f.*, row_number() over (order by f.codigo) as rn
  from public.familias_produto f
  join _forza_context ctx on ctx.empresa_id = f.empresa_id
), gerados as (
  select 'produto_acabado'::text as tipo_item, 'PA'::text as prefixo, gs as n from generate_series(1,250) gs
  union all select 'subconjunto', 'SC', gs from generate_series(1,550) gs
  union all select 'componente_fabricado', 'CF', gs from generate_series(1,2700) gs
), base as (
  select g.*, f.id as familia_id, f.codigo as familia_codigo, f.nome as familia_nome,
         get_byte(decode(md5(g.prefixo || g.n::text), 'hex'), 0) as variacao
  from gerados g
  join familias f on f.rn = ((g.n - 1) % 30) + 1
), descritos as (
  select b.*,
    case
      when b.tipo_item = 'produto_acabado' and b.familia_codigo like 'EIX-%' then
        'Eixo tubular para ' || (array['caminhão 6x2','ônibus urbano','semirreboque tandem','máquina agrícola'])[((b.n-1)%4)+1]
        || ', capacidade ' || (10 + (b.n % 9)) || ' toneladas, bitola ' || (1800 + (b.n % 9)*50) || ' mm'
      when b.tipo_item = 'produto_acabado' and b.familia_codigo = 'RES-AR' then
        'Reservatório de ar ' || (20 + (b.n % 7)*10) || ' litros, diâmetro ' || (220 + (b.n % 6)*28) || ' mm, pressão 12 bar'
      when b.tipo_item = 'produto_acabado' and b.familia_codigo like 'SUS-%' then
        b.familia_nome || ', carga ' || (8 + (b.n % 8)) || ' toneladas, configuração ' || (array['simples','tandem','tridem'])[((b.n-1)%3)+1]
      when b.tipo_item = 'produto_acabado' then
        b.familia_nome || ' para ' || (array['caminhão','ônibus','carreta','semirreboque','máquina agrícola'])[((b.n-1)%5)+1]
        || ', modelo FZ-' || lpad(b.n::text,4,'0') || ', acabamento ' || (array['fosfatizado','zincado','pintura epóxi','óleo protetivo'])[((b.n-1)%4)+1]
      when b.tipo_item = 'subconjunto' then
        'Subconjunto ' || lower(b.familia_nome) || ', aplicação ' || (array['chassi pesado','suspensão tandem','eixo direcional','implemento agrícola'])[((b.n-1)%4)+1]
        || ', aço ' || (array['SAE 1020','SAE 1045','Domex 700','ASTM A36'])[((b.n-1)%4)+1] || ', versão ' || (1 + b.n % 6)
      else
        (array['Suporte','Pino','Bucha','Flange','Travessa','Chapa de reforço','Anel','Mancal','Braço','Balancim','Terminal','Reforço','Base','Garfo','Ponta de eixo'])[((b.n-1)%15)+1]
        || ' fabricado, ' || (array['lado direito','lado esquerdo','posição central','aplicação universal'])[((b.n-1)%4)+1]
        || ', dimensão ' || (20 + (b.n % 36)*5) || ' mm, material ' || (array['SAE 1020','SAE 1045','SAE 4140','Domex 700','ASTM A36'])[((b.n-1)%5)+1]
        || ', acabamento ' || (array['usinado','temperado','zincado','soldado','jateado'])[((b.n-1)%5)+1]
    end as descricao
  from base b
)
insert into public.produtos (
  empresa_id, user_id, codigo, descricao, familia_id, tipo_item,
  unidade_medida, peso_kg, ativo, dados_demonstracao
)
select ctx.empresa_id, ctx.admin_id,
       d.prefixo || '-' || replace(d.familia_codigo,'-','') || '-' || lpad(d.n::text,4,'0'),
       d.descricao, d.familia_id, d.tipo_item, 'un',
       case d.tipo_item when 'produto_acabado' then 180 + (d.n % 900)
                            when 'subconjunto' then 20 + (d.n % 180)
                            else 0.5 + ((d.n % 600)::numeric / 10) end,
       true, true
from descritos d
cross join _forza_context ctx
on conflict (empresa_id, codigo) do update
set descricao = excluded.descricao,
    familia_id = excluded.familia_id,
    tipo_item = excluded.tipo_item,
    unidade_medida = excluded.unidade_medida,
    peso_kg = excluded.peso_kg,
    ativo = true,
    dados_demonstracao = true;

-- Espelho de estoque dos itens fabricados, conforme o modelo atual do ERP.
insert into public.insumos (
  empresa_id, codigo, descricao, unidade_medida, preco_unitario,
  estoque_minimo, tipo, familia_id, ativo, dados_demonstracao
)
select p.empresa_id, p.codigo, p.descricao, p.unidade_medida,
       case p.tipo_item when 'produto_acabado' then 2500 + (get_byte(decode(md5(p.codigo),'hex'),0) * 17)
                        when 'subconjunto' then 350 + (get_byte(decode(md5(p.codigo),'hex'),0) * 5)
                        else 25 + (get_byte(decode(md5(p.codigo),'hex'),0) * 1.7) end,
       case p.tipo_item when 'produto_acabado' then 2 when 'subconjunto' then 5 else 10 end,
       case p.tipo_item when 'produto_acabado' then 'produto_acabado' else 'semi_acabado' end,
       p.familia_id, true, true
from public.produtos p
join _forza_context ctx on ctx.empresa_id = p.empresa_id
where p.dados_demonstracao
on conflict (empresa_id, codigo) do update
set descricao = excluded.descricao,
    unidade_medida = excluded.unidade_medida,
    preco_unitario = excluded.preco_unitario,
    estoque_minimo = excluded.estoque_minimo,
    tipo = excluded.tipo,
    familia_id = excluded.familia_id,
    ativo = true,
    dados_demonstracao = true;

-- 7. Itens comprados, matérias-primas, embalagens e consumíveis
with gerados as (
  select 'CC'::text prefixo, 'componente_comprado'::text tipo, gs n,
         (array['CUBO','RLM','RET','PAR','POR','ARR','MOLA','BOLSA','VALV','CONEX','MANG','FREIO','ELET','TERMO','COROA','ENGR','ANEL','ABRA','REBITE','SENSOR'])[((gs-1)%20)+1] categoria,
         (array['Cubo de roda','Rolamento cônico','Retentor','Parafuso sextavado','Porca autotravante','Arruela de pressão','Mola semielíptica','Bolsa pneumática','Válvula pneumática','Conexão pneumática','Mangueira técnica','Componente de freio','Componente elétrico','Elemento de tratamento térmico','Coroa dentada','Engrenagem','Anel elástico','Abraçadeira','Rebite estrutural','Sensor de posição'])[((gs-1)%20)+1] base_nome
  from generate_series(1,900) gs
  union all
  select 'MP', 'materia_prima', gs,
         (array['CHAPAAC','CHAPAAR','TUBMEC','TUBEST','BARRED','BARQUA','BARCHA','PERFIL','EIXOBRU','ARAME'])[((gs-1)%10)+1],
         (array['Chapa de aço carbono','Chapa de aço de alta resistência','Tubo mecânico','Tubo estrutural','Barra redonda','Barra quadrada','Barra chata','Perfil metálico','Eixo bruto','Arame industrial'])[((gs-1)%10)+1]
  from generate_series(1,500) gs
  union all
  select 'EMB', 'embalagem', gs,
         (array['CAIXA','PALLET','FILME','CANT','ETIQ'])[((gs-1)%5)+1],
         (array['Caixa de papelão reforçada','Pallet de madeira tratada','Filme stretch industrial','Cantoneira de proteção','Etiqueta de identificação'])[((gs-1)%5)+1]
  from generate_series(1,150) gs
  union all
  select 'CON', 'consumivel', gs,
         (array['ARASOL','GAS','TINTA','SOLV','DISCO','OLEO','EPI','LIXA'])[((gs-1)%8)+1],
         (array['Arame de soldagem MIG/MAG','Gás de proteção para soldagem','Tinta industrial epóxi','Solvente de limpeza','Disco abrasivo','Óleo de corte','Item de proteção produtiva','Lixa industrial'])[((gs-1)%8)+1]
  from generate_series(1,150) gs
), descritos as (
  select g.*,
         g.base_nome || ', especificação ' || (array['leve','média','pesada','reforçada'])[((g.n-1)%4)+1]
         || ', dimensão ' || (6 + (g.n % 48)*2) || ' mm, modelo FZ-' || lpad(g.n::text,4,'0')
         || ', acabamento ' || (array['natural','zincado','fosfatizado','pintado'])[((g.n-1)%4)+1] as descricao,
         case
           when g.prefixo = 'MP' and g.categoria like 'CHAPA%' then 'chapa'
           when g.prefixo = 'MP' and g.categoria in ('TUBMEC','TUBEST','BARRED','BARQUA','BARCHA','PERFIL','EIXOBRU') then 'barra'
           when g.prefixo = 'CON' and g.categoria in ('GAS','TINTA','SOLV','OLEO') then 'L'
           when g.prefixo = 'CON' and g.categoria = 'ARASOL' then 'kg'
           else 'un'
         end as unidade
  from gerados g
)
insert into public.insumos (
  empresa_id, codigo, descricao, unidade_medida, preco_unitario,
  estoque_minimo, tipo, familia_id, ativo, dados_demonstracao
)
select ctx.empresa_id,
       d.prefixo || '-' || d.categoria || '-' || lpad(d.n::text,4,'0'),
       d.descricao, d.unidade,
       case d.prefixo when 'CC' then 15 + (d.n % 240) * 3.7
                      when 'MP' then 4 + (d.n % 80) * 1.2
                      when 'EMB' then 2 + (d.n % 45) * 0.8
                      else 3 + (d.n % 70) * 1.1 end,
       case d.prefixo when 'CC' then 20 when 'MP' then 100 when 'EMB' then 50 else 25 end,
       d.tipo,
       f.id,
       true, true
from descritos d
cross join _forza_context ctx
join lateral (
  select fp.id
  from public.familias_produto fp
  where fp.empresa_id = ctx.empresa_id
  order by fp.codigo
  offset ((d.n - 1) % 30) limit 1
) f on true
on conflict (empresa_id, codigo) do update
set descricao = excluded.descricao,
    unidade_medida = excluded.unidade_medida,
    preco_unitario = excluded.preco_unitario,
    estoque_minimo = excluded.estoque_minimo,
    tipo = excluded.tipo,
    familia_id = excluded.familia_id,
    ativo = true,
    dados_demonstracao = true;

-- 8. Fornecedores fictícios e vínculos de compra
with dados(codigo, nome, categoria, cidade) as (values
  ('FOR-001','Aços Horizonte Demo','Chapas de aço','Caxias do Sul'),
  ('FOR-002','Tubos Meridian Demo','Tubos e barras','Bento Gonçalves'),
  ('FOR-003','Cubos Vetor Demo','Cubos de roda','Farroupilha'),
  ('FOR-004','Rolamentos Prisma Demo','Rolamentos','Porto Alegre'),
  ('FOR-005','Pneumática Aurora Demo','Componentes pneumáticos','Canoas'),
  ('FOR-006','Fixadores Atlas Demo','Elementos de fixação','São Leopoldo'),
  ('FOR-007','Tintas Boreal Demo','Tintas industriais','Novo Hamburgo'),
  ('FOR-008','Solda Íon Demo','Consumíveis de soldagem','Gravataí'),
  ('FOR-009','Embalagens Delta Demo','Embalagens','Flores da Cunha'),
  ('FOR-010','Tratamentos Térmicos Solaris Demo','Tratamento térmico','Caxias do Sul'),
  ('FOR-011','Galvanização Nexo Demo','Galvanização','Sapucaia do Sul'),
  ('FOR-012','Pintura Industrial Lume Demo','Pintura','Caxias do Sul'),
  ('FOR-013','Molas Impulso Demo','Molas','Panambi'),
  ('FOR-014','Freios Órbita Demo','Componentes de freio','Erechim'),
  ('FOR-015','Conexões Trama Demo','Conexões e mangueiras','Porto Alegre'),
  ('FOR-016','Elétrica Quasar Demo','Componentes elétricos','Cachoeirinha'),
  ('FOR-017','Perfis Vértice Demo','Perfis metálicos','Guaíba'),
  ('FOR-018','Forjados Pioneiro Demo','Eixos brutos e forjados','Caxias do Sul'),
  ('FOR-019','Ferramentas Circuito Demo','Ferramentas e abrasivos','Esteio'),
  ('FOR-020','Logística Pampa Demo','Serviços logísticos','Vacaria')
)
insert into public.fornecedores (
  empresa_id, codigo, razao_social, nome_fantasia, categoria,
  cnpj, email, telefone, cidade, estado, status, dados_demonstracao
)
select ctx.empresa_id, d.codigo, d.nome || ' Ltda.', d.nome, d.categoria,
       'DEMO-CNPJ-' || right(d.codigo,3),
       lower(replace(replace(d.codigo,'FOR-','for'),'-','')) || '@fornecedores.example',
       '(00) 0000-' || right('0000' || right(d.codigo,3),4), d.cidade, 'RS', 'ativo', true
from _forza_context ctx
cross join dados d
on conflict (empresa_id, codigo) do update
set razao_social = excluded.razao_social,
    nome_fantasia = excluded.nome_fantasia,
    categoria = excluded.categoria,
    cnpj = excluded.cnpj,
    email = excluded.email,
    telefone = excluded.telefone,
    cidade = excluded.cidade,
    estado = excluded.estado,
    status = excluded.status,
    dados_demonstracao = true,
    updated_at = now();

with itens as (
  select i.*, row_number() over (order by i.codigo) as rn
  from public.insumos i
  join _forza_context ctx on ctx.empresa_id = i.empresa_id
  where i.tipo in ('componente_comprado','materia_prima','embalagem','consumivel')
), fornecedores as (
  select f.*, row_number() over (order by f.codigo) as rn
  from public.fornecedores f
  join _forza_context ctx on ctx.empresa_id = f.empresa_id
)
insert into public.fornecedor_insumos (
  empresa_id, fornecedor_id, insumo_id, codigo_fornecedor,
  prazo_dias, lote_minimo, principal
)
select i.empresa_id, f.id, i.id,
       'REF-' || replace(i.codigo,'-',''),
       5 + (i.rn % 26),
       greatest(1, i.estoque_minimo / 2),
       true
from itens i
join fornecedores f on f.rn = ((i.rn - 1) % 20) + 1
on conflict (empresa_id, fornecedor_id, insumo_id) do update
set codigo_fornecedor = excluded.codigo_fornecedor,
    prazo_dias = excluded.prazo_dias,
    lote_minimo = excluded.lote_minimo,
    principal = excluded.principal;

-- 9. Estruturas de produto multinível e sem ciclos
with pais as (
  select p.*, row_number() over (partition by p.tipo_item order by p.codigo) as rn
  from public.produtos p
  join _forza_context ctx on ctx.empresa_id = p.empresa_id
), filhos as (
  select i.*,
         case
           when i.codigo like 'SC-%' then 'SC'
           when i.codigo like 'CF-%' then 'CF'
           when i.codigo like 'CC-%' then 'CC'
           when i.codigo like 'MP-%' then 'MP'
           when i.codigo like 'EMB-%' then 'EMB'
           when i.codigo like 'CON-%' then 'CON'
         end as classe,
         row_number() over (partition by
           case when i.codigo like 'SC-%' then 'SC' when i.codigo like 'CF-%' then 'CF'
                when i.codigo like 'CC-%' then 'CC' when i.codigo like 'MP-%' then 'MP'
                when i.codigo like 'EMB-%' then 'EMB' when i.codigo like 'CON-%' then 'CON' end
           order by i.codigo) as rn,
         count(*) over (partition by
           case when i.codigo like 'SC-%' then 'SC' when i.codigo like 'CF-%' then 'CF'
                when i.codigo like 'CC-%' then 'CC' when i.codigo like 'MP-%' then 'MP'
                when i.codigo like 'EMB-%' then 'EMB' when i.codigo like 'CON-%' then 'CON' end) as total
  from public.insumos i
  join _forza_context ctx on ctx.empresa_id = i.empresa_id
  where i.codigo like any (array['SC-%','CF-%','CC-%','MP-%','EMB-%','CON-%'])
), slots(tipo_pai, sequencia, classe_filho, deslocamento, quantidade) as (values
  ('produto_acabado',1,'SC',0,1::numeric), ('produto_acabado',2,'SC',37,1),
  ('produto_acabado',3,'CF',0,2), ('produto_acabado',4,'CF',101,2), ('produto_acabado',5,'CF',307,1),
  ('produto_acabado',6,'CC',0,2), ('produto_acabado',7,'CC',83,4),
  ('produto_acabado',8,'MP',0,12.5), ('produto_acabado',9,'CON',0,0.35), ('produto_acabado',10,'EMB',0,1),
  ('subconjunto',1,'CF',0,2), ('subconjunto',2,'CF',71,2), ('subconjunto',3,'CF',223,1),
  ('subconjunto',4,'CC',0,4), ('subconjunto',5,'CC',59,2),
  ('subconjunto',6,'MP',0,8.5), ('subconjunto',7,'CON',0,0.20),
  ('componente_fabricado',1,'MP',0,2.75),
  ('componente_fabricado',2,'CC',0,1),
  ('componente_fabricado',3,'CON',0,0.08)
), estrutura as (
  select p.empresa_id, p.codigo as produto_codigo, f.id as insumo_id,
         s.quantidade + ((p.rn + s.sequencia) % 3) * case when s.classe_filho='MP' then 0.5 else 0 end as quantidade,
         f.unidade_medida, s.sequencia,
         case p.tipo_item when 'produto_acabado' then 1 when 'subconjunto' then 2 else 3 end as nivel
  from pais p
  join slots s on s.tipo_pai = p.tipo_item
  join filhos f on f.classe = s.classe_filho
    and f.rn = ((p.rn + s.deslocamento - 1) % f.total) + 1
)
insert into public.bom_itens (
  empresa_id, produto_codigo, insumo_id, quantidade, unidade_medida,
  observacao, sequencia, nivel, dados_demonstracao
)
select e.empresa_id, e.produto_codigo, e.insumo_id, e.quantidade,
       e.unidade_medida, 'Estrutura industrial demonstrativa multinível.',
       e.sequencia, e.nivel, true
from estrutura e
on conflict (empresa_id, produto_codigo, insumo_id) do update
set quantidade = excluded.quantidade,
    unidade_medida = excluded.unidade_medida,
    observacao = excluded.observacao,
    sequencia = excluded.sequencia,
    nivel = excluded.nivel,
    dados_demonstracao = true;

-- 10. Roteiros determinísticos para todos os 3.500 itens fabricados
with produtos_rank as (
  select p.*, row_number() over (partition by p.tipo_item order by p.codigo) as rn
  from public.produtos p
  join _forza_context ctx on ctx.empresa_id = p.empresa_id
  where p.dados_demonstracao and p.ativo
), passos as (
  select * from (values
    ('produto_acabado',1,'Separação de materiais','ALMOX',8::numeric,1.5::numeric,1),
    ('produto_acabado',2,'Serra de Tubo','SERRA',14,5,1),
    ('produto_acabado',3,'Corte Laser','CORTE',24,4,1),
    ('produto_acabado',4,'Prensagem','PRENSA',28,6,1),
    ('produto_acabado',5,'Ponteamento','SOLDA',12,14,2),
    ('produto_acabado',6,'Soldagem MIG/MAG','SOLDA',18,35,2),
    ('produto_acabado',7,'Usinagem de acabamento','USIN',48,42,1),
    ('produto_acabado',8,'Montagem mecânica','MONT',16,55,2),
    ('produto_acabado',9,'Inspeção final','QUAL',8,12,1),
    ('produto_acabado',10,'Expedição','EXP',6,8,1),
    ('subconjunto',1,'Separação de materiais','ALMOX',6,1,1),
    ('subconjunto',2,'Corte Plasma','CORTE',18,6,1),
    ('subconjunto',3,'Dobra múltipla','DOBRA',22,9,1),
    ('subconjunto',4,'Soldagem robotizada','SOLDA',30,22,1),
    ('subconjunto',5,'Torneamento CNC','USIN',42,28,1),
    ('subconjunto',6,'Inspeção dimensional','QUAL',7,8,1),
    ('subconjunto',7,'Armazenagem','ALMOX',4,2,1)
  ) p(tipo_item, ordem, nome, setor_codigo, setup_base, tempo_base, operadores)
), rotas_fixas as (
  select p.*, ps.ordem, ps.nome, ps.setor_codigo, ps.setup_base, ps.tempo_base, ps.operadores
  from produtos_rank p
  join passos ps on ps.tipo_item = p.tipo_item
  where p.tipo_item in ('produto_acabado','subconjunto')
), rotas_cf as (
  select p.*, v.ordem, v.nome, v.setor_codigo, v.setup_base, v.tempo_base, v.operadores
  from produtos_rank p
  cross join lateral (values
    (1, 'Separação de materiais', 'ALMOX', 5::numeric, 1::numeric, 1),
    (2,
      case p.rn % 5 when 0 then 'Corte Laser' when 1 then 'Serra de Barra' when 2 then 'Estampagem' when 3 then 'Aquecimento' else 'Torneamento CNC' end,
      case p.rn % 5 when 0 then 'CORTE' when 1 then 'SERRA' when 2 then 'PRENSA' when 3 then 'FORJA' else 'USIN' end,
      10::numeric + (p.rn % 20), 3::numeric + (p.rn % 18), 1),
    (3,
      case p.rn % 5 when 0 then 'Dobra simples' when 1 then 'Torneamento CNC' when 2 then 'Furação em prensa' when 3 then 'Forjamento' else 'Fresamento CNC' end,
      case p.rn % 5 when 0 then 'DOBRA' when 1 then 'USIN' when 2 then 'PRENSA' when 3 then 'FORJA' else 'USIN' end,
      12::numeric + (p.rn % 25), 4::numeric + (p.rn % 35), 1),
    (4, 'Acabamento', case when p.rn % 3 = 0 then 'SOLDA' else 'USIN' end, 8::numeric + (p.rn % 15), 3::numeric + (p.rn % 24), 1),
    (5, 'Inspeção dimensional', 'QUAL', 4::numeric + (p.rn % 8), 2::numeric + (p.rn % 12), 1)
  ) v(ordem,nome,setor_codigo,setup_base,tempo_base,operadores)
  where p.tipo_item = 'componente_fabricado'
), todas_rotas as (
  select * from rotas_fixas
  union all
  select * from rotas_cf
)
insert into public.operacoes (
  empresa_id, produto_id, ordem, codigo, nome, descricao, tempo, unidade,
  setup_time, setor_id, quantidade_operadores, tamanho_lote, versao,
  vigencia, ativo, dados_demonstracao
)
select r.empresa_id, r.id, r.ordem,
       'FZ-' || replace(r.codigo,'-','') || '-OP' || lpad(r.ordem::text,2,'0'),
       r.nome,
       r.nome || ' do roteiro ' || r.codigo || '.',
       r.tempo_base + (get_byte(decode(md5(r.codigo || r.ordem::text),'hex'),0) % 17),
       'min',
       r.setup_base + (get_byte(decode(md5(r.codigo || 'setup' || r.ordem::text),'hex'),0) % 11),
       s.id, r.operadores,
       10 + (r.rn % 41), '1.0', date '2026-08-01', true, true
from todas_rotas r
join public.setores s on s.empresa_id = r.empresa_id and s.codigo = r.setor_codigo
on conflict (empresa_id, produto_id, ordem) do update
set codigo = excluded.codigo,
    nome = excluded.nome,
    descricao = excluded.descricao,
    tempo = excluded.tempo,
    unidade = excluded.unidade,
    setup_time = excluded.setup_time,
    setor_id = excluded.setor_id,
    quantidade_operadores = excluded.quantidade_operadores,
    tamanho_lote = excluded.tamanho_lote,
    versao = excluded.versao,
    vigencia = excluded.vigencia,
    ativo = true,
    dados_demonstracao = true;

with ops as (
  select o.id, o.setor_id,
         row_number() over (partition by o.setor_id order by p.codigo, o.ordem) as rn
  from public.operacoes o
  join public.produtos p on p.id = o.produto_id and p.empresa_id = o.empresa_id
  join _forza_context ctx on ctx.empresa_id = o.empresa_id
  where o.dados_demonstracao
), maquinas_rank as (
  select m.id, m.setor_id,
         row_number() over (partition by m.setor_id order by m.codigo) as rn,
         count(*) over (partition by m.setor_id) as total
  from public.maquinas m
  join _forza_context ctx on ctx.empresa_id = m.empresa_id
  where m.status = 'ativa'
)
update public.operacoes o
set maquina_id = m.id
from ops op
join maquinas_rank m on m.setor_id = op.setor_id and m.rn = ((op.rn - 1) % m.total) + 1
where o.id = op.id;

insert into public.operacao_postos_trabalho (empresa_id, operacao_id, maquina_id, ativo)
select o.empresa_id, o.id, o.maquina_id, true
from public.operacoes o
join _forza_context ctx on ctx.empresa_id = o.empresa_id
where o.dados_demonstracao and o.maquina_id is not null
on conflict (empresa_id, operacao_id, maquina_id) do update
set ativo = true;

with maquinas_rank as (
  select m.id, m.empresa_id, m.setor_id,
         row_number() over (partition by m.empresa_id, m.setor_id order by m.codigo) as rn,
         count(*) over (partition by m.empresa_id, m.setor_id) as total
  from public.maquinas m
  join _forza_context ctx on ctx.empresa_id = m.empresa_id
  where m.status = 'ativa'
), ops as (
  select o.id, o.empresa_id, o.setor_id, atual.rn, atual.total
  from public.operacoes o
  join maquinas_rank atual on atual.id = o.maquina_id
  join _forza_context ctx on ctx.empresa_id = o.empresa_id
  where o.dados_demonstracao
)
insert into public.operacao_postos_trabalho (empresa_id, operacao_id, maquina_id, ativo)
select op.empresa_id, op.id, alternativa.id, true
from ops op
join maquinas_rank alternativa
  on alternativa.empresa_id = op.empresa_id
 and alternativa.setor_id = op.setor_id
 and alternativa.rn = (op.rn % op.total) + 1
on conflict (empresa_id, operacao_id, maquina_id) do update
set ativo = true;

-- 11. Estoque inicial coerente dos 5.200 itens
with itens as (
  select i.*, row_number() over (order by i.codigo) as rn
  from public.insumos i
  join _forza_context ctx on ctx.empresa_id = i.empresa_id
  where i.dados_demonstracao and i.ativo
), calculado as (
  select i.*,
    case when i.rn % 19 = 0 then 0::numeric
         when i.rn % 13 = 0 then greatest(0.1, i.estoque_minimo * 0.5)
         else greatest(1, i.estoque_minimo * (2 + (i.rn % 4))) end as saldo,
    case
      when i.tipo = 'produto_acabado' then 'Estoque de Produtos Acabados'
      when i.tipo = 'semi_acabado' then 'Estoque Intermediário'
      when i.tipo = 'componente_comprado' then 'Almoxarifado de Componentes'
      when i.tipo = 'materia_prima' and (i.codigo like 'MP-CHAPA%') then 'Almoxarifado de Chapas'
      when i.tipo = 'materia_prima' then 'Almoxarifado de Tubos e Barras'
      when i.tipo in ('embalagem','consumivel') then 'Almoxarifado de Componentes'
      else 'Quarentena da Qualidade'
    end as local_nome
  from itens i
)
insert into public.saldo_estoque (
  empresa_id, insumo_id, saldo_atual, custo_medio, valor_total,
  local_id, updated_at, dados_demonstracao
)
select c.empresa_id, c.id, c.saldo, c.preco_unitario,
       round(c.saldo * c.preco_unitario, 2), l.id, now(), true
from calculado c
join public.locais_estoque l on l.empresa_id = c.empresa_id and l.nome = c.local_nome
on conflict (empresa_id, insumo_id) do update
set saldo_atual = excluded.saldo_atual,
    custo_medio = excluded.custo_medio,
    valor_total = excluded.valor_total,
    local_id = excluded.local_id,
    updated_at = now(),
    dados_demonstracao = true;

insert into public.movimentacoes_estoque (
  empresa_id, insumo_id, tipo, quantidade, quantidade_anterior,
  quantidade_posterior, origem, observacao, created_by,
  custo_unitario, valor_total, local_id
)
select s.empresa_id, s.insumo_id, 'entrada', s.saldo_atual, 0, s.saldo_atual,
       'seed_forza', 'Saldo inicial demonstrativo da FORZA IMPLEMENTOS.',
       ctx.admin_id, s.custo_medio, s.valor_total, s.local_id
from public.saldo_estoque s
join _forza_context ctx on ctx.empresa_id = s.empresa_id
where s.dados_demonstracao
  and s.saldo_atual > 0
  and not exists (
    select 1 from public.movimentacoes_estoque m
    where m.empresa_id = s.empresa_id
      and m.insumo_id = s.insumo_id
      and m.origem = 'seed_forza'
  );

-- 12. Ordens de produção demonstrativas (42)
with produtos_pa as (
  select p.*, row_number() over (order by p.codigo) as rn
  from public.produtos p
  join _forza_context ctx on ctx.empresa_id = p.empresa_id
  where p.tipo_item = 'produto_acabado' and p.dados_demonstracao
  order by p.codigo
  limit 42
)
insert into public.ordens_producao (
  empresa_id, user_id, numero_op, data_programacao, data_entrega,
  produto_codigo, quantidade, regra_calculo, agrupar_setup,
  status, prioridade, dados_demonstracao
)
select p.empresa_id, ctx.admin_id, 'FZ-OP-' || lpad(p.rn::text,4,'0'),
       case when p.rn >= 39 then date '2026-07-15' + ((p.rn - 39)::integer)
            else date '2026-08-03' + (p.rn::integer) end,
       case when p.rn >= 39 then date '2026-07-24' + ((p.rn - 39)::integer)
            else date '2026-08-10' + (p.rn::integer) end,
       p.codigo,
       20 + (p.rn % 9) * 10,
       case p.rn % 3 when 0 then 'gargalo' when 1 then 'soma' else 'media' end,
       p.rn % 4 = 0,
       case when p.rn <= 8 then 'planejada'
            when p.rn <= 16 then 'liberada'
            when p.rn <= 24 then 'em_andamento'
            when p.rn <= 31 then 'parcial'
            when p.rn <= 38 then 'encerrada'
            else 'atrasada' end,
       1 + (p.rn % 5), true
from produtos_pa p
join _forza_context ctx on ctx.empresa_id = p.empresa_id
on conflict (empresa_id, numero_op) do update
set user_id = excluded.user_id,
    data_programacao = excluded.data_programacao,
    data_entrega = excluded.data_entrega,
    produto_codigo = excluded.produto_codigo,
    quantidade = excluded.quantidade,
    regra_calculo = excluded.regra_calculo,
    agrupar_setup = excluded.agrupar_setup,
    status = excluded.status,
    prioridade = excluded.prioridade,
    dados_demonstracao = true;

with alvos as (
  select op.*, p.id as produto_id,
         case when op.status = 'parcial' then greatest(1, floor(op.quantidade * 0.45)::int)
              else op.quantidade end as produzido
  from public.ordens_producao op
  join public.produtos p on p.empresa_id = op.empresa_id and p.codigo = op.produto_codigo
  join _forza_context ctx on ctx.empresa_id = op.empresa_id
  where op.dados_demonstracao and op.status in ('parcial','encerrada')
), ultima_operacao as (
  select distinct on (o.produto_id) o.produto_id, o.id, o.nome, o.maquina_id
  from public.operacoes o
  join alvos a on a.produto_id = o.produto_id and a.empresa_id = o.empresa_id
  order by o.produto_id, o.ordem desc
)
insert into public.apontamentos (
  empresa_id, user_id, ordem_id, operacao_id, operacao_nome, maquina_id,
  data_apontamento, hora_inicio, hora_fim, pecas_produzidas,
  pecas_refugo, pecas_retrabalho, observacao, cronometro_total_segundos,
  status, encerramento
)
select a.empresa_id, ctx.admin_id, a.id, u.id, u.nome, u.maquina_id,
       least(a.data_programacao + 2, date '2026-08-01'),
       time '07:00', time '08:00', a.produzido, 0, 0,
       'SEED FORZA - apontamento demonstrativo ' || a.status,
       3600, 'finalizado', case when a.status='parcial' then 'parcial' else 'total' end
from alvos a
join ultima_operacao u on u.produto_id = a.produto_id
join _forza_context ctx on ctx.empresa_id = a.empresa_id
where not exists (
  select 1 from public.apontamentos ap
  where ap.empresa_id = a.empresa_id
    and ap.ordem_id = a.id
    and ap.operacao_id = u.id
    and ap.observacao like 'SEED FORZA%'
);

-- Validações essenciais: qualquer falha desfaz toda a execução.
do $$
declare
  v_empresa uuid := (select empresa_id from _forza_context);
  v_erros text[] := '{}';
begin
  if (select count(*) from public.empresas where nome='FORZA IMPLEMENTOS') <> 1 then v_erros := array_append(v_erros,'empresa'); end if;
  if (select count(*) from public.funcionarios where empresa_id=v_empresa and status='ativo') <> 294 then v_erros := array_append(v_erros,'funcionarios_total'); end if;
  if (select count(*) from public.funcionarios f join public.setores s on s.id=f.setor_id where f.empresa_id=v_empresa and s.produtivo) <> 235 then v_erros := array_append(v_erros,'funcionarios_produtivos'); end if;
  if (select count(*) from public.funcionarios f join public.setores s on s.id=f.setor_id where f.empresa_id=v_empresa and not s.produtivo) <> 59 then v_erros := array_append(v_erros,'funcionarios_apoio'); end if;
  if (select count(*) from public.insumos where empresa_id=v_empresa and ativo and dados_demonstracao) < 5200 then v_erros := array_append(v_erros,'itens'); end if;
  if (select count(*) from public.maquinas where empresa_id=v_empresa and eh_equipamento and dados_demonstracao) <> 67 then v_erros := array_append(v_erros,'equipamentos'); end if;
  if exists (select 1 from public.produtos p where p.empresa_id=v_empresa and p.ativo and not exists (select 1 from public.operacoes o where o.empresa_id=v_empresa and o.produto_id=p.id and o.ativo)) then v_erros := array_append(v_erros,'roteiros_ausentes'); end if;
  if exists (select 1 from public.produtos p where p.empresa_id=v_empresa and p.tipo_item='produto_acabado' and not exists (select 1 from public.bom_itens b where b.empresa_id=v_empresa and b.produto_codigo=p.codigo)) then v_erros := array_append(v_erros,'bom_pa_ausente'); end if;
  if exists (select 1 from public.operacoes where empresa_id=v_empresa and (setor_id is null or tempo <= 0 or setup_time < 0)) then v_erros := array_append(v_erros,'operacoes_invalidas'); end if;
  if exists (select 1 from public.maquinas where empresa_id=v_empresa and setor_id is null) then v_erros := array_append(v_erros,'postos_sem_setor'); end if;
  if exists (select 1 from public.operacoes o where o.empresa_id=v_empresa and not exists (select 1 from public.operacao_postos_trabalho opt where opt.empresa_id=v_empresa and opt.operacao_id=o.id and opt.ativo)) then v_erros := array_append(v_erros,'operacoes_sem_posto'); end if;
  if (select count(*) from public.ordens_producao where empresa_id=v_empresa and dados_demonstracao) <> 42 then v_erros := array_append(v_erros,'ordens'); end if;
  if exists (select 1 from public.produtos where dados_demonstracao and empresa_id<>v_empresa) then v_erros := array_append(v_erros,'isolamento_produtos'); end if;
  if exists (select 1 from public.funcionarios where dados_demonstracao and empresa_id<>v_empresa) then v_erros := array_append(v_erros,'isolamento_funcionarios'); end if;

  if cardinality(v_erros) > 0 then
    raise exception 'Seed FORZA reprovado nas validações: %', array_to_string(v_erros, ', ');
  end if;
end;
$$;

commit;
