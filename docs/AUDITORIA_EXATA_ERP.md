# Auditoria técnica, funcional e de integridade — Exata ERP

Data da auditoria: 2026-08-04
Branch de trabalho: `audit/integridade-fluxo-exata`
Commit auditado/publicado: `1dd655930112e7927918e0e3a1f4acff5e0bb9d6`

## 1. Escopo e método

Esta auditoria cobre o fluxo de produção do cadastro mestre ao estoque, incluindo frontend Next.js, funções PostgreSQL, triggers, RLS, dados reais, indicadores e implantação. A análise combinou leitura estática do repositório, consultas somente leitura ao projeto Supabase, inspeção das políticas e privilégios, advisors de segurança/desempenho e comparação do commit local com o commit aprovado pela Vercel.

Nenhum dado de produção foi alterado durante o diagnóstico. Registros órfãos ou suspeitos não foram excluídos, encerrados nem normalizados automaticamente.

## 2. Resumo executivo

O sistema possui uma boa base para transações de apontamento e estoque, mas ainda não preserva integralmente a cadeia histórica. A finalização transacional consolida a quantidade da ordem pela menor quantidade concluída entre operações obrigatórias, evitando multiplicar uma mesma peça pelo número de etapas. Contudo, essa regra consulta o roteiro ativo atual, e não o roteiro efetivamente liberado para cada ordem. Alterações e exclusões físicas no cadastro podem, portanto, mudar o significado histórico de ordens e apontamentos.

O incidente mostrado no vídeo foi confirmado no banco:

- apontamento `17ce8a3f-5663-4a6d-8295-75f9519d4511` permanece `em_andamento` desde 2026-08-03 13:30:51 no horário de São Paulo;
- o usuário é Rodrigo Zin e a máquina registrada é `Cost. Prog. G`;
- a ordem e a operação referenciadas já não existem;
- não há movimentação de estoque nem evento normal de início para o registro;
- a interface restaurou corretamente o cronômetro persistido; o problema é o estado inválido persistido, não uma conversão UTC/local;
- a origem exibida como “Sistema” é um fallback de apresentação quando não existe evento de auditoria de início.

Foram encontrados 39 apontamentos ligados a ordens inexistentes, 2 ligados a operações inexistentes, 36 registros legados sem `user_id` e 1 apontamento ativo inválido. Esses números são fotografia do diagnóstico e devem ser revalidados pelo script em `supabase/diagnostics/auditoria_integridade.sql` antes de qualquer saneamento.

## 3. Achados priorizados

### Críticos

#### C-01 — Histórico pode ser órfão por exclusão física

O frontend executa exclusão física de ordens, produtos, máquinas e operações. Ao salvar um roteiro, todas as operações do produto são excluídas e recriadas com novos UUIDs. A tabela `apontamentos` não possui chaves estrangeiras para ordem, operação, máquina e usuário. O resultado é a perda de referencialidade observada em produção.

Impactos:

- cronômetros ativos sem contexto recuperável;
- rastreabilidade e auditoria incompletas;
- relatórios e OEE incluindo registros sem cadeia válida;
- impossibilidade de provar qual roteiro uma ordem utilizou;
- exclusão de uma operação já utilizada sem bloqueio estrutural.

Correção necessária: impedir novas referências inválidas no banco, substituir exclusões destrutivas por inativação/versionamento e preservar um snapshot imutável do roteiro da ordem.

#### C-02 — Roteiro da ordem não é versionado

As funções de consolidação e encerramento consultam as operações ativas atuais do produto. Uma mudança no GBO pode alterar retroativamente as operações obrigatórias de uma ordem já liberada ou iniciada.

Correção necessária: gravar, na liberação da ordem, as operações, sequência, tempos e obrigatoriedade usadas. Apontamento, progresso e encerramento devem consultar esse snapshot.

#### C-03 — Migrações de produção fora do histórico oficial

Na fotografia inicial, o ledger `supabase_migrations.schema_migrations` terminava em `20260801235652`, mas o schema já continha funções e triggers descritos por migrações locais de 2026-08-03. Isso caracteriza drift entre repositório, ledger e banco de produção. Em 2026-08-04 foram registradas as migrations `20260804125917_integridade_fluxo_exata` e `20260804130930_indices_integridade_fluxo_exata`; o drift histórico anterior permanece documentado e pendente de reconciliação.

Correção necessária: gerar inventário canônico, reconciliar o ledger sem reaplicar DDL já existente, testar em ambiente isolado e só então promover migrações novas.

#### C-04 — Superfície de privilégios maior que a necessária

O papel `authenticated` possui privilégios amplos, inclusive `DELETE`, `TRUNCATE`, `REFERENCES` e `TRIGGER` em tabelas relevantes. RLS reduz o alcance de linhas, mas não substitui privilégio de objeto. Os advisors também apontam 14 funções `SECURITY DEFINER` executáveis por usuários autenticados.

Correção necessária: revogar privilégios não usados, conceder apenas `SELECT` e RPCs necessárias, retirar execução pública de helpers e manter validação explícita de empresa, usuário e permissão dentro de cada função privilegiada.

### Altos

#### A-01 — Início não produz evento normal de auditoria

O início transacional registra exceção de horário, quando aplicável, mas não registra um evento normal de início. A tela recorre ao rótulo genérico “Sistema”, impossibilitando distinguir clique do operador, rotina administrativa ou importação.

#### A-02 — Idempotência insuficiente no início

Existe trava transacional por usuário e limite de apontamentos ativos, porém perfis autorizados a múltiplos apontamentos podem criar duas sessões para o mesmo contexto. Não existe chave idempotente nem unicidade parcial por empresa, usuário, ordem, operação e máquina.

#### A-03 — Indicadores aceitam órfãos

O filtro compartilhado rejeita cancelados e estornados, mas não exige ordem, produto, operação e empresa válidos. Dashboard e relatórios podem consumir registros órfãos.

#### A-04 — OEE global sem ponderação e sem fonte única

Disponibilidade, desempenho e qualidade são calculados no frontend. O OEE global é média aritmética dos OEEs de máquinas, em vez de ser derivado de totais ou ponderado por tempo/capacidade. Não existe visão/RPC canônica com rastreabilidade da fórmula.

#### A-05 — Pausas sem vínculo estrutural completo

Há registros de pausa e processamento automático, porém o vínculo com apontamento não está protegido por chave estrangeira. Pausa manual, pausa programada e retomada precisam compartilhar uma máquina de estados única.

### Médios

#### M-01 — Takt, ciclo, gargalo, soma e média são apresentados como sinônimos

No GBO, o modo padrão `takt` usa o maior tempo de operação. O mesmo valor é mostrado como “Tempo de Ciclo” e “Tempo de Ciclo Total”. O rótulo selecionado também troca “soma” e “média”. Para o produto 2040, os seis tempos totalizam 88 s; a média é 14,67 s; o gargalo é 31 s. A tela apresenta 0,52 min por usar o gargalo de 31 s como se fosse total.

Takt real depende de demanda e tempo disponível, portanto não pode ser inferido apenas do roteiro.

#### M-02 — Realtime não está configurado

Nenhuma tabela pública está na publicação `supabase_realtime`, e o frontend atual usa polling. Não foram encontrados listeners duplicados, mas o sistema também não tem atualização Realtime ponta a ponta.

#### M-03 — Índices e políticas precisam de revisão

Os advisors apontam 23 chaves estrangeiras sem índice, 5 políticas com avaliação repetida de `auth.*`, 4 conjuntos de políticas permissivas sobrepostas e 21 índices ainda sem uso observado. Índices sem uso não devem ser removidos apenas pelo advisor; é necessário observar carga real e planos.

#### M-04 — Registros legados incompletos

Há apontamentos finalizados sem `finalizado_em` e registros sem usuário. Eles precisam ser classificados por origem e evidência antes de qualquer backfill.

### Informativos

- RLS está habilitado nas tabelas públicas relevantes.
- `codigos_acesso`, `super_admins` e `user_invitations` têm RLS sem políticas, comportamento que pode ser intencional para acesso exclusivo por backend privilegiado.
- A proteção contra senhas vazadas está desabilitada no Auth.
- A função de estoque usa delta idempotente e trava as linhas centrais antes de movimentar saldo.
- Não foram encontrados movimentos de produção sem apontamento, eventos de ordem órfãos ou quantidades negativas na fotografia analisada.

## 4. Cadeia de causa do incidente

1. Um apontamento válido foi iniciado explicitamente e persistido com `cronometro_inicio`.
2. A ordem e a operação foram posteriormente excluídas fisicamente ou recriadas com outros UUIDs.
3. A ausência de chaves estrangeiras permitiu que o apontamento continuasse ativo e órfão.
4. Ao selecionar o posto, o frontend consultou a sessão ativa e restaurou o tempo desde `cronometro_inicio`.
5. Como não existe evento normal de início, a auditoria apresentou a origem fallback “Sistema”.

A seleção do posto, no código atual, não inicia um apontamento por si só. O início é chamado no clique explícito. Isso deve ser preservado por teste de regressão.

## 5. Integridade por domínio

| Domínio | Situação observada | Risco principal |
|---|---|---|
| Empresas/perfis | RLS presente; privilégios amplos | acesso de objeto maior que o necessário |
| Produtos/GBO | operações excluídas e recriadas | perda de identidade e histórico |
| Máquinas/postos | exclusão física disponível | apontamento perde contexto |
| Ordens | exclusão física disponível; produto por código textual | ordem histórica pode desaparecer ou mudar de produto |
| Apontamentos | transações e locks presentes; FKs centrais ausentes | órfãos e sessão fantasma |
| Pausas | estado funcional presente; FK incompleta | pausa órfã ou sequência inválida |
| Estoque | delta/idempotência e reversão presentes | depende da integridade anterior |
| OEE/relatórios | fórmulas locais e filtro fraco | divergência entre telas e dupla interpretação |
| Auditoria | estorno auditável; início comum não auditado | origem e causalidade incompletas |

## 6. Ordem segura de remediação

1. Congelar exclusões físicas dos cadastros que já tenham dependências.
2. Instalar diagnósticos read-only e capturar evidências/backup lógico dos registros suspeitos.
3. Introduzir constraints `NOT VALID` para impedir novos órfãos sem apagar o legado.
4. Criar snapshot/versionamento do roteiro por ordem e migrar as funções de progresso.
5. Adicionar evento de início e idempotência de comandos.
6. Centralizar métricas e rejeitar órfãos em consumidores operacionais.
7. Reduzir grants e execução de funções após teste de todos os papéis.
8. Classificar e sanear dados legados em migração separada, reversível e aprovada.
9. Validar constraints apenas quando o relatório de exceções estiver zerado.

## 7. Critérios para tratar o legado

Nenhuma correção automática deve “adivinhar” uma ordem ou operação ausente. Para cada órfão, a classificação deve usar, nesta ordem:

1. evento de produção/auditoria existente;
2. movimentação de estoque vinculada;
3. snapshot ou export histórico;
4. correspondência inequívoca por empresa, produto, máquina, usuário e janela temporal;
5. marcação explícita como legado não reconciliado quando não houver prova suficiente.

O registro do vídeo deve ser encerrado ou estornado somente após decisão operacional e preservação da evidência.

## 8. Estado de implantação

O commit auditado coincide com `origin/main` e com o commit que recebeu status de implantação Vercel bem-sucedido. A branch local `main` estava cinco commits atrás, mas isso não significa divergência entre a branch auditada e o remoto principal.

## 9. Entregáveis relacionados

- `docs/MAPA_FLUXO_DADOS.md`: produtores, transformações, persistência e consumidores.
- `docs/REGRAS_DE_NEGOCIO.md`: regras oficiais e máquinas de estado propostas.
- `supabase/diagnostics/auditoria_integridade.sql`: relatório SQL somente leitura e repetível.
- `docs/RELATORIO_FINAL_AUDITORIA.md`: validações, correções implementadas, pendências e rollback.
