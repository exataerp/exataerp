-- Estrutura industrial complementar para seeds de demonstração por tenant.
-- Todas as tabelas novas preservam o isolamento por empresa_id e respeitam RLS.

alter table public.empresas
  add column if not exists pais text default 'Brasil',
  add column if not exists regime_producao text,
  add column if not exists tipo_producao text,
  add column if not exists funcionarios_producao integer,
  add column if not exists funcionarios_apoio integer,
  add column if not exists percentual_produtivo numeric(5,2);

create table if not exists public.unidades_empresa (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null,
  nome text not null,
  descricao text,
  tipo text not null default 'industrial',
  principal boolean not null default false,
  pais text not null default 'Brasil',
  estado text,
  cidade text,
  endereco text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, codigo)
);

create table if not exists public.setores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  unidade_id uuid references public.unidades_empresa(id) on delete set null,
  codigo text not null,
  nome text not null,
  descricao text,
  tipo text not null,
  centro_custo text,
  capacidade_horas_dia numeric(8,2),
  produtivo boolean not null default false,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, codigo),
  unique (empresa_id, nome)
);

create table if not exists public.familias_produto (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null,
  nome text not null,
  descricao text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, codigo),
  unique (empresa_id, nome)
);

create table if not exists public.funcionarios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  matricula text not null,
  nome text not null,
  setor_id uuid not null references public.setores(id) on delete restrict,
  cargo text not null,
  funcao text not null,
  turno_id uuid references public.turnos(id) on delete set null,
  status text not null default 'ativo',
  data_admissao date not null,
  email text,
  acesso_sistema boolean not null default false,
  user_id uuid references auth.users(id) on delete set null,
  dados_demonstracao boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, matricula),
  constraint funcionarios_status_check check (status in ('ativo', 'afastado', 'inativo'))
);

create table if not exists public.fornecedores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null,
  razao_social text not null,
  nome_fantasia text not null,
  categoria text not null,
  cnpj text,
  email text,
  telefone text,
  cidade text,
  estado text,
  status text not null default 'ativo',
  dados_demonstracao boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, codigo),
  constraint fornecedores_status_check check (status in ('ativo', 'inativo', 'bloqueado'))
);

create table if not exists public.fornecedor_insumos (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  fornecedor_id uuid not null references public.fornecedores(id) on delete cascade,
  insumo_id uuid not null references public.insumos(id) on delete cascade,
  codigo_fornecedor text,
  prazo_dias integer not null default 15,
  lote_minimo numeric not null default 1,
  principal boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (empresa_id, fornecedor_id, insumo_id),
  constraint fornecedor_insumos_prazo_check check (prazo_dias >= 0),
  constraint fornecedor_insumos_lote_check check (lote_minimo > 0)
);

alter table public.produtos
  add column if not exists familia_id uuid references public.familias_produto(id) on delete set null,
  add column if not exists tipo_item text not null default 'produto_acabado',
  add column if not exists unidade_medida text not null default 'un',
  add column if not exists peso_kg numeric(12,3),
  add column if not exists ativo boolean not null default true,
  add column if not exists dados_demonstracao boolean not null default false;

alter table public.insumos
  add column if not exists familia_id uuid references public.familias_produto(id) on delete set null,
  add column if not exists ativo boolean not null default true,
  add column if not exists dados_demonstracao boolean not null default false;

alter table public.maquinas
  add column if not exists setor_id uuid references public.setores(id) on delete set null,
  add column if not exists tipo_recurso text not null default 'equipamento',
  add column if not exists eh_equipamento boolean not null default true,
  add column if not exists turno_id uuid references public.turnos(id) on delete set null,
  add column if not exists taxa_horaria numeric(12,2) not null default 0,
  add column if not exists eficiencia_padrao numeric(5,2) not null default 85,
  add column if not exists tempo_disponivel_minutos integer not null default 480,
  add column if not exists calendario jsonb not null default '{"dias":[1,2,3,4,5]}'::jsonb,
  add column if not exists dados_demonstracao boolean not null default false;

alter table public.operacoes
  add column if not exists codigo text,
  add column if not exists descricao text,
  add column if not exists setor_id uuid references public.setores(id) on delete set null,
  add column if not exists quantidade_operadores integer not null default 1,
  add column if not exists tamanho_lote integer not null default 1,
  add column if not exists versao text not null default '1.0',
  add column if not exists vigencia date not null default current_date,
  add column if not exists ativo boolean not null default true,
  add column if not exists dados_demonstracao boolean not null default false;

alter table public.bom_itens
  add column if not exists sequencia integer not null default 1,
  add column if not exists nivel integer not null default 1,
  add column if not exists dados_demonstracao boolean not null default false;

alter table public.saldo_estoque
  add column if not exists local_id uuid references public.locais_estoque(id) on delete set null,
  add column if not exists dados_demonstracao boolean not null default false;

alter table public.ordens_producao
  add column if not exists data_entrega date,
  add column if not exists prioridade integer not null default 3,
  add column if not exists dados_demonstracao boolean not null default false;

create unique index if not exists maquinas_empresa_codigo_uidx
  on public.maquinas (empresa_id, codigo);

create unique index if not exists turnos_empresa_nome_uidx
  on public.turnos (empresa_id, nome);

create unique index if not exists locais_estoque_empresa_nome_uidx
  on public.locais_estoque (empresa_id, nome);

create unique index if not exists ordens_producao_empresa_numero_uidx
  on public.ordens_producao (empresa_id, numero_op);

create unique index if not exists operacoes_empresa_produto_ordem_uidx
  on public.operacoes (empresa_id, produto_id, ordem);

create unique index if not exists bom_itens_empresa_produto_insumo_uidx
  on public.bom_itens (empresa_id, produto_codigo, insumo_id);

create index if not exists setores_empresa_tipo_idx
  on public.setores (empresa_id, tipo, ativo);

create index if not exists funcionarios_empresa_setor_idx
  on public.funcionarios (empresa_id, setor_id, status);

create index if not exists produtos_empresa_tipo_ativo_idx
  on public.produtos (empresa_id, tipo_item, ativo);

create index if not exists insumos_empresa_tipo_ativo_idx
  on public.insumos (empresa_id, tipo, ativo);

create index if not exists maquinas_empresa_setor_ativo_idx
  on public.maquinas (empresa_id, setor_id, status);

create index if not exists operacoes_empresa_setor_ativo_idx
  on public.operacoes (empresa_id, setor_id, ativo);

create index if not exists fornecedor_insumos_insumo_idx
  on public.fornecedor_insumos (insumo_id);

alter table public.unidades_empresa enable row level security;
alter table public.setores enable row level security;
alter table public.familias_produto enable row level security;
alter table public.funcionarios enable row level security;
alter table public.fornecedores enable row level security;
alter table public.fornecedor_insumos enable row level security;

grant select, insert, update, delete on public.unidades_empresa to authenticated;
grant select, insert, update, delete on public.setores to authenticated;
grant select, insert, update, delete on public.familias_produto to authenticated;
grant select, insert, update, delete on public.funcionarios to authenticated;
grant select, insert, update, delete on public.fornecedores to authenticated;
grant select, insert, update, delete on public.fornecedor_insumos to authenticated;

drop policy if exists empresa_autorizada on public.unidades_empresa;
create policy empresa_autorizada on public.unidades_empresa
for all to authenticated
using ((select public.tem_acesso_empresa(empresa_id)) or (select public.is_master()))
with check ((select public.tem_acesso_empresa(empresa_id)) or (select public.is_master()));

drop policy if exists empresa_autorizada on public.setores;
create policy empresa_autorizada on public.setores
for all to authenticated
using ((select public.tem_acesso_empresa(empresa_id)) or (select public.is_master()))
with check ((select public.tem_acesso_empresa(empresa_id)) or (select public.is_master()));

drop policy if exists empresa_autorizada on public.familias_produto;
create policy empresa_autorizada on public.familias_produto
for all to authenticated
using ((select public.tem_acesso_empresa(empresa_id)) or (select public.is_master()))
with check ((select public.tem_acesso_empresa(empresa_id)) or (select public.is_master()));

drop policy if exists empresa_autorizada on public.funcionarios;
create policy empresa_autorizada on public.funcionarios
for all to authenticated
using ((select public.tem_acesso_empresa(empresa_id)) or (select public.is_master()))
with check ((select public.tem_acesso_empresa(empresa_id)) or (select public.is_master()));

drop policy if exists empresa_autorizada on public.fornecedores;
create policy empresa_autorizada on public.fornecedores
for all to authenticated
using ((select public.tem_acesso_empresa(empresa_id)) or (select public.is_master()))
with check ((select public.tem_acesso_empresa(empresa_id)) or (select public.is_master()));

drop policy if exists empresa_autorizada on public.fornecedor_insumos;
create policy empresa_autorizada on public.fornecedor_insumos
for all to authenticated
using ((select public.tem_acesso_empresa(empresa_id)) or (select public.is_master()))
with check ((select public.tem_acesso_empresa(empresa_id)) or (select public.is_master()));
