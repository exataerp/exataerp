# Relatório final — auditoria do Exata ERP

Data: 2026-08-04
Branch: `audit/integridade-fluxo-exata`
Base auditada: `1dd655930112e7927918e0e3a1f4acff5e0bb9d6`

> Atualização pós-deploy: o frontend foi publicado e a validação executada está registrada em `docs/VALIDACAO_POS_DEPLOY.md`. Esse documento posterior prevalece sobre as marcações pré-publicação das seções 7 a 13 abaixo. A estabilização total continua aberta pelos critérios explicitamente pendentes nessa validação.

## 1. Parecer

O incidente do cronômetro foi reproduzido e explicado por evidência de banco e código. Não houve início automático causado apenas pela seleção do posto. O apontamento foi persistido como ativo e depois perdeu sua ordem e operação por exclusões físicas sem chaves estrangeiras. Ao reabrir a tela, o frontend restaurou corretamente a sessão persistida e mostrou o tempo acumulado. A origem “Sistema” era um fallback para evento ausente.

A correção estrutural foi aplicada ao banco de produção após confirmação de backup físico, ausência de sessões concorrentes e duas execuções integrais com `ROLLBACK`. Ela inclui snapshot de roteiro por ordem, versionamento do GBO, FKs `NOT VALID` para preservar o legado, início idempotente e auditado, exclusão segura, métricas centralizadas e filtros de integridade nos consumidores. Uma ponte temporária mantém a assinatura anterior da RPC de início compatível até a publicação do frontend.

## 2. Evidência do incidente

| Campo | Valor confirmado |
|---|---|
| apontamento | `17ce8a3f-5663-4a6d-8295-75f9519d4511` |
| usuário | Rodrigo Zin |
| início UTC | 2026-08-03 16:30:51.662399+00 |
| início São Paulo | 2026-08-03 13:30:51 |
| status/estado | `em_andamento` / `em_execucao` |
| máquina | `Cost. Prog. G` |
| ordem referenciada | ausente |
| operação referenciada | ausente |
| movimento de estoque | ausente |
| evento normal de início | ausente |

O registro não foi alterado. A decisão de encerrá-lo ou estorná-lo é operacional e deve ocorrer somente depois de exportar a evidência e escolher o tratamento do legado.

## 3. Fotografia de integridade

- 82 apontamentos;
- 39 apontamentos com ordem ausente;
- 2 apontamentos com operação ausente;
- 36 apontamentos legados sem usuário;
- 1 apontamento ativo inválido, correspondente ao incidente;
- nenhuma duplicidade exata entre os quatro apontamentos realmente `em_andamento`;
- nenhum movimento de produção sem apontamento;
- nenhum evento de ordem ou pausa órfão na fotografia consultada;
- nenhum tenant divergente nas referências ainda existentes;
- nenhuma quantidade negativa encontrada;
- 72 registros não ativos sem `finalizado_em`, classificados como legado pendente.

O script `supabase/diagnostics/auditoria_integridade.sql` foi executado integralmente em transação `READ ONLY` e finalizado com `ROLLBACK`.

## 4. Schema, RLS e privilégios

### Confirmado

- 45 tabelas públicas relevantes com RLS habilitado;
- 63 políticas RLS;
- nenhuma tabela pública na publicação `supabase_realtime`;
- uma Edge Function ativa: `admin-create-manual-invite`, com JWT obrigatório;
- 18 funções públicas e 19 privadas na fotografia consultada;
- funções de produção transacionais usam `SECURITY DEFINER`, locks e checagens internas;
- o papel `authenticated` possui grants mais amplos que os necessários em tabelas centrais;
- os advisors apontaram 14 funções privilegiadas executáveis por autenticados, 23 FKs sem índice, 5 políticas com avaliação repetida de `auth.*`, 4 conjuntos de políticas permissivas sobrepostas e 21 índices sem uso observado;
- proteção de senha vazada está desabilitada no Auth.

RLS e grants são camadas diferentes; a redução de grants deve acompanhar os testes de cada papel. As recomendações oficiais estão em [Securing your API](https://supabase.com/docs/guides/api/securing-your-api), [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) e [Supabase Changelog](https://supabase.com/changelog).

### Implementado localmente

- revogação de `DELETE`, `TRUNCATE`, `REFERENCES` e `TRIGGER` das tabelas centrais para `anon`/`authenticated` onde a aplicação não precisa desses privilégios;
- helpers privados permanecem sem `EXECUTE` para papéis da API;
- novas RPCs validam sessão e acesso à empresa;
- snapshot tem RLS e apenas `SELECT` direto para autenticados;
- exclusões históricas são bloqueadas por trigger e FK.

## 5. Migrações e drift

Na fotografia inicial, o ledger de produção terminava em `20260801235652`, enquanto o schema continha objetos definidos por migrations locais de 2026-08-03. Isso confirma DDL aplicado sem registro correspondente ou ledger incompleto. As correções foram criadas pelo Supabase CLI como:

`supabase/migrations/20260804114526_integridade_fluxo_exata.sql`

`supabase/migrations/20260804130820_indices_integridade_fluxo_exata.sql`

Após a aplicação, o Supabase registrou `20260804125917_integridade_fluxo_exata` e `20260804130930_indices_integridade_fluxo_exata`. A tentativa de branch isolado confirmou o drift: o ambiente nasceu sem tabelas públicas e com `MIGRATIONS_FAILED`, pois o repositório não contém uma migration-base reproduzível. O branch temporário foi excluído imediatamente. A DDL foi então validada no schema real dentro de transação revertida, com `lock_timeout` de 3 segundos, antes da aplicação definitiva.

O procedimento de reconciliação histórica continua obrigatório:

1. exportar schema, ledger, funções e dados críticos de produção;
2. comparar checksums/DDL das migrations de 2026-08-02 e 2026-08-03 com o schema real;
3. em branch Supabase ou clone isolado, marcar como aplicadas somente as versões comprovadamente idênticas;
4. executar todas as migrations desde uma base limpa e comparar o schema resultante;
5. aplicar a migration de integridade no ambiente isolado;
6. executar diagnóstico, testes concorrentes e advisors;
7. promover banco antes do frontend.

Não é seguro inserir versões no ledger apenas porque objetos com nomes semelhantes existem.

## 6. Correções entregues

### 6.1 Integridade referencial sem apagar o legado

- FKs compostas empresa/ordem, empresa/operação e empresa/máquina em `apontamentos`, todas `ON DELETE RESTRICT NOT VALID`;
- FK de pausa para apontamento `NOT VALID`;
- novas escritas exigem empresa, operação, máquina, usuário e cronômetro ativo válidos;
- a FK produto/operação deixa de usar cascata destrutiva;
- constraints antigas só serão validadas depois de classificar as exceções.

`NOT VALID` é intencional: bloqueia novas violações sem falsificar ou apagar o histórico já incompatível.

### 6.2 Roteiro versionado e snapshot por OP

- `ordens_producao` passa a referenciar `produto_id` e `roteiro_versao`;
- `ordem_producao_operacoes` congela UUID, sequência, tempos, setup, obrigatoriedade e postos da ordem;
- `ordem_producao_bom_itens` congela insumos e quantidades; a finalização de estoque consome esse snapshot;
- ordens existentes recebem snapshot com origem explícita `auditoria_2026_08_04_roteiro_ativo`, pois não é possível provar uma versão histórica diferente;
- novas ordens recebem snapshot na mesma transação de criação;
- consolidação, encerramento, fila do posto e seleção de operação usam o snapshot;
- GBO cria nova versão, inativa a anterior e preserva UUIDs usados;
- GBO, operações e BOM são salvos na RPC transacional `salvar_roteiro_produto`.

### 6.3 Início idempotente e auditável

- cada clique gera `command_id` UUID;
- índice único por empresa/comando;
- índice único parcial para o contexto ativo empresa/usuário/ordem/operação/máquina;
- advisory lock serializa o contexto;
- repetição equivalente devolve o apontamento existente;
- início normal grava `production_report_started`, origem `operator`;
- a auditoria mostra “Origem não registrada (legado)” quando a origem realmente não existe.

### 6.4 Exclusão segura

- produto e máquina são inativados no frontend;
- ordem em rascunho e sem histórico pode ser excluída pela RPC;
- ordem com histórico é cancelada com motivo e evento;
- ordem com apontamento ativo não pode ser cancelada;
- apontamento e movimento continuam sem exclusão física;
- produto, operação, máquina e ordem com histórico são protegidos no banco.

### 6.5 Métricas

- `lib/production-metrics.ts` centraliza conversão de tempo, total/média/gargalo, takt, planejamento e OEE;
- takt retorna “não calculável” sem tempo disponível e demanda;
- planejamento da OP usa a soma sequencial dos ciclos, não média ou gargalo;
- OEE global é recalculado pelos totais compatíveis, não por média simples de percentuais;
- dashboard e relatórios rejeitam apontamentos cuja ordem, operação ou máquina não exista;
- produto 2040: total 88 s, média 14,67 s e gargalo 31 s; 0,52 min deixa de ser exibido como total.

## 7. Cobertura dos cenários solicitados

Os cenários A–I são os definidos no pedido original: apontamento inválido, início normal, duplo clique, cinco operações, parcial, refugo, tempo de ciclo, encerramento/estorno e multitenant. A classificação pós-publicação, sem promover testes estáticos a evidência funcional, está em `docs/VALIDACAO_POS_DEPLOY.md`.

Resultado local final:

- 73 testes aprovados;
- typecheck aprovado;
- lint aprovado com 0 erros e 16 avisos preexistentes (15 de hooks e 1 diretiva sem uso); o aviso introduzido no gráfico foi removido;
- build Next.js 16.2.9 aprovado, 13 páginas geradas;
- `git diff --check` sem erros.

O build também informa que a convenção `middleware` foi depreciada em favor de `proxy`; não é causa do incidente e ficou fora da correção funcional.

## 8. Commit publicado e Vercel

A correção foi publicada pela branch `audit/integridade-fluxo-exata`, commit `7d3144ce4070024ace247f6a01c0ead6aa78754e`, no PR 24. O merge de produção é `e6fd2e0d6cd1969c3c1000de6ce58e70d138be64`; a comparação entre os dois commits não contém diferença de arquivos, somente o commit de integração. O status da Vercel para o merge ficou `success` e a aplicação autenticada foi exercitada em `https://exataerp.vercel.app`.

As migrations e o frontend da correção estão em produção. As pontes permanecem disponíveis somente como compatibilidade temporária e possuem plano de retirada em `docs/PONTE_COMPATIBILIDADE_RPC.md`.

## 9. Ordem de implantação

1. Concluído: confirmar backup físico restaurável e janela sem concorrência.
2. Concluído: exportar e executar os diagnósticos.
3. Concluído: provar o drift com branch Supabase descartável.
4. Concluído: validar a DDL integral duas vezes com `ROLLBACK` no schema real.
5. Concluído: executar testes, advisors e checagens de papéis/privilégios.
6. Concluído: aplicar as quatro migrations de estabilização no banco.
7. Concluído: confirmar RPCs, snapshots, índices e ausência de erros PostgreSQL.
8. Concluído: publicar o frontend da mesma revisão.
9. Parcial: executar smoke tests autenticados A–I no frontend publicado; A aprovado, B parcial e C–I pendentes.
10. Pendente: monitorar erros, duplicidades, sessões ativas, estoque e OEE.
11. Concluído: classificar o legado sem alterar vínculos; validar as FKs `NOT VALID` somente em migration posterior e após decisão humana.

Banco e frontend precisam ser promovidos nessa ordem. O frontend novo depende das RPCs e da tabela de snapshot.

## 10. Rollback

Se a migration falhar, a transação PostgreSQL reverte o conjunto. Depois de aplicada com sucesso:

1. voltar o frontend para o commit anterior somente se os grants antigos forem restaurados de forma controlada;
2. restaurar a assinatura anterior da RPC de início;
3. restaurar funções de consolidação anteriores;
4. remover triggers de snapshot/proteção somente após confirmar que nenhuma ordem nova depende deles;
5. preservar `command_id`, snapshots, eventos e colunas aditivas para não perder trilha;
6. nunca apagar snapshots ou eventos como mecanismo de rollback;
7. preferir uma migration compensatória revisada a comandos manuais.

## 11. Pendências que exigem decisão ou ambiente

- reconciliar o ledger de migrations;
- publicação concluída pelo push Git e conector GitHub; PR 24 integrado e Vercel com status `success`;
- obter a decisão operacional da Mairo entre encerramento administrativo e estorno auditado do apontamento de Rodrigo Zin; a decisão técnica de preservar e não relinkar já está registrada;
- decidir backfill de `finalizado_em` com evidência suficiente;
- revisar os 23 índices de FKs preexistentes restantes e as políticas apontadas pelos advisors; as 11 novas FKs desta correção já receberam índices de cobertura;
- habilitar proteção de senha vazada no Auth após avaliação da política de acesso;
- decidir se Realtime é necessário; polling atual é funcional e não há listeners duplicados;
- validar as constraints `NOT VALID` apenas quando as exceções forem tratadas;
- migrar `middleware` para `proxy` em mudança independente.

## 12. Conclusão

A causa-raiz não era um cronômetro visual isolado. Era a ausência de preservação histórica entre GBO, ordens e apontamentos. A correção entregue muda o contrato: ordem usa roteiro congelado, operações usadas mantêm identidade, início é explícito/idempotente/auditado, exclusão vira transição de estado e indicadores consomem apenas cadeias válidas. O legado permanece visível para tratamento controlado, sem limpeza destrutiva.

## 13. Regra definitiva de exclusão de OP

As migrations `bloqueio_exclusao_op_com_apontamentos` e `preservar_eventos_producao` foram aplicadas depois de validação integral com `ROLLBACK`. A exclusão física direta foi fechada por trigger; snapshots, eventos, apontamentos, pausas, movimentos e auditoria não possuem caminho destrutivo por `CASCADE` no fluxo protegido.

Em produção, com contexto autenticado de administrador e transações revertidas quando aplicável, passaram OP-01 a OP-09. Isso comprovou rascunho limpo com auditoria; bloqueio de apontamento ativo, pausado, finalizado e estornado; bloqueio de movimento remanescente; isolamento de tenant; bloqueio de `DELETE` direto; e serialização real entre início e exclusão em duas sessões simultâneas. A evidência detalhada está em `docs/VALIDACAO_POS_DEPLOY.md`.

A política é mais estrita que a possibilidade genérica descrita originalmente para OP-05: qualquer apontamento preservado, inclusive estornado, bloqueia definitivamente a exclusão física da OP.
