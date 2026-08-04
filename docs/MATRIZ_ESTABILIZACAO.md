# Matriz de estabilização

Atualizada em 2026-08-04 após a publicação do frontend e os testes autenticados descritos em `docs/VALIDACAO_POS_DEPLOY.md`.

| Alteração | Arquivo ou migration | Apenas local | Banco de produção | Frontend publicado | Validada em produção |
|---|---:|---:|---:|---:|---:|
| Bloqueio de exclusão de OP | `20260804133527_bloqueio_exclusao_op_com_apontamentos.sql` | não | sim | sim | sim: OP-01–09; evidência visual OP-01/02 |
| Eventos sem cascata destrutiva | `20260804140016_preservar_eventos_producao.sql` | não | sim | n/a | sim: zero `CASCADE` relevante |
| Revogação de grants centrais | `20260804114526_integridade_fluxo_exata.sql` | não | sim | n/a | sim: catálogo e advisors |
| RLS dos snapshots | `20260804114526_integridade_fluxo_exata.sql` | não | sim | n/a | sim: catálogo |
| RPC de exclusão segura | `excluir_ordem_producao_segura` | não | sim | sim | sim: transações autenticadas e UI |
| Ponte de exclusão | `cancelar_ou_excluir_ordem_producao` | não | sim | não utilizada pelo frontend novo | sim; retirada ainda planejada |
| Snapshot de roteiro | `ordem_producao_operacoes` | não | sim | sim | sim: 48 OPs/450 linhas na fotografia de aplicação |
| Snapshot de BOM | `ordem_producao_bom_itens` | não | sim | sim | sim: 420 linhas na fotografia de aplicação |
| Início idempotente | RPC com `p_command_id` | não | sim | sim | banco/testes locais; recuperação pós-reload publicada |
| Ponte de início | sobrecarga de seis argumentos | não | sim | não utilizada pelo frontend novo | compatibilidade validada; retirada planejada |
| Proteção de exclusões históricas | triggers e FKs `RESTRICT` | não | sim | n/a | sim: OP-02–09 |
| Métricas centralizadas | `lib/production-metrics.ts` e consumidores | não | n/a | sim | teste local; regressão A–I publicada ainda incompleta |
| Filtros de integridade dos dashboards | componentes corrigidos | não | n/a | sim | teste local; smoke publicado parcial |
| Produto 2040 = 88 s | métrica canônica | não | dados em produção | sim | teste local exato; prova publicada pendente |
| OEE ponderado | métrica canônica | não | dados em produção | sim | teste local; cenário publicado pendente |
| Encerramento por todas as operações | RPC/snapshot | não | sim | sim | banco/teste local; cenário D publicado pendente |
| Quantidades aprovadas/estoque | consolidação transacional | não | sim | sim | banco/teste local; cenários D–H publicados pendentes |

“Validada em produção” identifica a camada realmente exercitada. A publicação, por si só, não aprova uma regressão funcional. A estabilização completa permanece aberta enquanto os cenários A–I que exigem um ciclo produtivo fresco não forem executados no frontend publicado, a reconstrução limpa das migrations não passar e não houver decisão operacional para o apontamento legado de Rodrigo Zin.
