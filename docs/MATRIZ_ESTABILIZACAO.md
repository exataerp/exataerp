# Matriz de estabilização

Atualizada em 2026-08-04 antes da publicação do frontend.

| Alteração | Arquivo/migration | Local | Banco produção | Frontend publicado | Validada em produção |
|---|---|---:|---:|---:|---:|
| Bloqueio de exclusão de OP | `20260804133527_bloqueio_exclusao_op_com_apontamentos.sql` | sim | sim | não | banco: OP-01–06, 08–09 |
| Eventos sem cascata destrutiva | `20260804140016_preservar_eventos_producao.sql` | sim | sim | n/a | sim, zero CASCADE relevante |
| Revogação de grants centrais | `20260804114526_integridade_fluxo_exata.sql` | sim | sim | n/a | sim, catálogo |
| RLS dos snapshots | `20260804114526_integridade_fluxo_exata.sql` | sim | sim | n/a | sim, catálogo |
| RPC de exclusão segura | `excluir_ordem_producao_segura` | sim | sim | não | sim, transação autenticada |
| Ponte de exclusão | `cancelar_ou_excluir_ordem_producao` | sim | sim | versão antiga usa | sim, bloqueio conservador |
| Snapshot de roteiro | `ordem_producao_operacoes` | sim | sim | ainda não publicado | 48/48 OPs, 450 linhas |
| Snapshot de BOM | `ordem_producao_bom_itens` | sim | sim | ainda não publicado | 420 linhas |
| Início idempotente | RPC com `p_command_id` | sim | sim | não | banco e testes locais |
| Ponte de início | sobrecarga de seis argumentos | sim | sim | versão antiga usa | compatibilidade no banco |
| Proteção de exclusões históricas | trigger/FKs `RESTRICT` | sim | sim | n/a | sim |
| Métricas centralizadas | `lib/production-metrics.ts` e consumidores | sim | n/a | não | teste local |
| Filtros de integridade dos dashboards | componentes corrigidos | sim | n/a | não | teste local |
| Produto 2040 = 88 s | métrica canônica | sim | dados em produção | não | teste local; UI pendente |
| OEE ponderado | métrica canônica | sim | dados em produção | não | teste local; UI pendente |
| Encerramento por todas as operações | RPC/snapshot | sim | sim | não | banco e teste local |
| Quantidades aprovadas/estoque | consolidação transacional | sim | sim | não | banco e teste local |

“Validada em produção” não significa “validada no frontend publicado”. OP-07 concorrente, os cenários A–I e a prova visual OP-01–09 continuam pendentes até publicação e execução autenticada real.
