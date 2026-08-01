# Carga industrial — FORZA IMPLEMENTOS

## Escopo

A carga configura a empresa fictícia **Forza Implementos Rodoviários Ltda.** no tenant já existente da **FORZA IMPLEMENTOS**. Todos os registros usam chaves determinísticas e operações de `upsert`, permitindo reexecução sem duplicidade.

Nenhuma tabela foi removida, a RLS continua ativa e os dados de outros tenants não são atualizados pelo seed.

## Arquivos

- `supabase/migrations/20260801223000_configura_conta_teste_forza_implementos.sql`: identifica a conta de demonstração, a empresa e o administrador Tiago Prado.
- `supabase/migrations/20260801225206_estrutura_industrial_forza.sql`: adiciona as estruturas industriais que não existiam e complementa as tabelas atuais.
- `supabase/migrations/20260801231215_indices_relacionamentos_forza.sql`: adiciona os índices dos novos relacionamentos.
- `supabase/seed_forza_implementos.sql`: carga completa, determinística e idempotente.
- `supabase/validation/validate_forza_implementos.sql`: validações automáticas de cardinalidade, integridade, ciclos, roteiros, vínculos e isolamento.

## Execução

Com o projeto Supabase vinculado e a variável `SUPABASE_DB_URL` contendo a conexão direta do banco:

```powershell
supabase db push
psql "$env:SUPABASE_DB_URL" --set=ON_ERROR_STOP=1 --file=supabase/seed_forza_implementos.sql
psql "$env:SUPABASE_DB_URL" --set=ON_ERROR_STOP=1 --file=supabase/validation/validate_forza_implementos.sql
```

O seed é transacional. Quando o executor remoto tiver limite curto de tempo, as seções numeradas do próprio arquivo podem ser executadas em lotes, na ordem indicada.

## Resultado aplicado em produção

| Cadastro | Quantidade |
| --- | ---: |
| Empresas configuradas | 1 |
| Unidades industriais | 1 |
| Turnos | 2 |
| Setores produtivos | 11 |
| Áreas administrativas e de apoio | 12 |
| Funcionários produtivos | 235 |
| Funcionários administrativos e de apoio | 59 |
| Funcionários totais | 294 |
| Equipamentos produtivos | 67 |
| Postos de trabalho totais | 80 |
| Famílias de produto | 30 |
| Produtos acabados | 250 |
| Subconjuntos | 550 |
| Componentes fabricados | 2.700 |
| Componentes comprados | 900 |
| Matérias-primas | 500 |
| Embalagens | 150 |
| Consumíveis | 150 |
| Itens ativos totais | 5.200 |
| Linhas de estrutura/BOM | 14.450 |
| Produtos fabricados com roteiro | 3.500 |
| Operações de roteiro | 19.850 |
| Vínculos operação/posto | 39.450 |
| Locais de estoque | 7 |
| Fornecedores fictícios | 20 |
| Vínculos fornecedor/item | 1.700 |
| Ordens de produção demonstrativas | 42 |

## Validações

Foram executadas 23 regras automáticas. Todas passaram, incluindo:

- distribuição exata dos 294 funcionários;
- 5.200 itens ativos;
- todos os 3.500 produtos fabricados com roteiro;
- todos os produtos acabados com BOM;
- nenhum ciclo ou quantidade inválida nas estruturas;
- nenhum roteiro com sequência duplicada ou tempo inválido;
- operações, máquinas e postos vinculados aos setores corretos;
- itens comprados sem roteiro produtivo indevido;
- disponibilidade de operações nos postos para a tela de apontamentos;
- reexecução integral sem duplicação;
- isolamento do tenant da FORZA IMPLEMENTOS.

Resultado final: **23/23 validações aprovadas e 0 erros**.

## Ajustes no frontend

- O Estoque reconhece e exibe as categorias `Componente Comprado`, `Embalagem` e `Consumível`.
- A tela de Apontamentos carrega somente os produtos das OPs retornadas, evitando consultar os 3.500 produtos fabricados e suas 19.850 operações a cada abertura.
- O filtro por posto continua usando os vínculos `operacao_postos_trabalho`, preservando a regra de mostrar apenas trabalhos compatíveis com o posto selecionado.
