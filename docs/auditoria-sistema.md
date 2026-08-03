# Auditoria do Sistema

## Escopo entregue

A primeira estratégia de estorno cobre apontamentos de produção. A arquitetura foi preparada para receber outras estratégias por entidade, sem expor um `DELETE` genérico.

O lançamento original permanece em `apontamentos`. O estado operacional passa para `cancelado`, enquanto os campos `estornado_em`, `estornado_por`, `motivo_estorno_*` e `estorno_audit_log_id` identificam inequivocamente o estorno. O status apresentado na Auditoria é `estornado`.

## Fluxo transacional

A RPC `estornar_apontamento_auditoria`:

1. valida a sessão, a permissão `auditoria.estornar` e o tenant;
2. bloqueia o apontamento e a OP com `FOR UPDATE`;
3. impede repetição por status, chave de idempotência e índices únicos;
4. bloqueia lançamentos ativos e registros legados sem vínculos suficientes;
5. verifica o saldo de cada entrada de produção antes de criar a saída inversa;
6. cria uma movimentação inversa para cada movimentação original, mantendo o vínculo `reverses_movement_id`;
7. atualiza os saldos e o crédito consolidado da OP;
8. marca o apontamento como estornado logicamente;
9. recalcula a operação e a OP pelas quantidades ainda válidas;
10. grava `audit_logs` e `production_order_events` na mesma transação.

Qualquer erro desfaz todas as alterações operacionais. A API registra uma ocorrência técnica `reversal_failed` depois do rollback, sem alterar o lançamento.

## Estoque e dependências

- Uma entrada original gera `estorno_saida`.
- Uma saída original gera `estorno_entrada`.
- A movimentação original nunca é apagada nem alterada.
- Se o saldo atual for menor que a entrada que precisa ser retirada, o estorno é bloqueado e as dependências são devolvidas à interface.
- Movimentações posteriores não são reescritas automaticamente.

## OEE, produtividade e relatórios

O estado operacional usado no banco é `cancelado`, já ignorado pela consolidação transacional existente. Dashboard, Apontamento e Relatórios também filtram `cancelado`, `cancelada` e `estornado`. O consumo de estoque dos relatórios considera o efeito líquido entre a saída original e a entrada inversa.

Não existem tabelas agregadas, views materializadas ou cache persistente de OEE neste projeto. Os indicadores são recalculados sob demanda a partir dos apontamentos válidos e das quantidades consolidadas da OP.

## Segurança

Permissões criadas:

- `auditoria.visualizar`
- `auditoria.estornar`
- `auditoria.exportar`
- `auditoria.visualizar_detalhes`
- `auditoria.visualizar_valores_sensiveis`

O papel `system_manager` recebe todas por padrão. O acesso é verificado no frontend, nas APIs e novamente nas RPCs. As funções com `security definer` confirmam que o perfil ativo pertence ao mesmo tenant.

`audit_logs` possui RLS de leitura por permissão e não concede `INSERT`, `UPDATE` ou `DELETE` a usuários autenticados. Um trigger bloqueia qualquer alteração ou exclusão do histórico. Triggers adicionais bloqueiam exclusão física de apontamentos e mutação/exclusão de movimentações auditáveis.

## Dados legados

Apontamentos concluídos antes da introdução de `finalizado_em` recebem esse metadado pela migration de compatibilidade `20260803190000_libera_estorno_apontamentos_legados.sql`, usando `updated_at` e, como fallback, `created_at`. Isso libera o estorno de operações intermediárias antigas, que corretamente não possuem movimentação de estoque.

O backfill não altera saldos. Ao estornar um registro antigo, somente movimentações de estoque explicitamente vinculadas pelo par `empresa_id + referencia_id` são compensadas. A correção do metadado também fica registrada em `audit_logs` com a ação `legacy_metadata_backfilled`.

Como proteção adicional, o endpoint de estorno executa o mesmo saneamento de forma idempotente para um lançamento antigo ainda não migrado. A interface apresenta o aviso como informativo e mantém o botão disponível; vínculos estruturais ausentes ou saldo insuficiente continuam bloqueando o processo.

## Limites atuais

- Estratégia ativa: apontamento de produção.
- Refugo é recalculado quando faz parte do próprio apontamento; um módulo de refugo independente precisará de estratégia própria.
- Não há módulos fiscais, faturamento, fechamento de período ou custo médio processado no schema versionado disponível; dependências desses domínios deverão ser adicionadas antes de habilitar seus estornos.
- A exportação CSV é paginada no banco e limitada a 10.000 registros por arquivo para proteger memória e tempo de resposta.

## Rollback

O rollback operacional deve remover grants/RPCs e os triggers de entrada, mas preservar `audit_logs`, campos de estorno e movimentações inversas que já tenham sido criadas. Uma movimentação inversa nunca deve ser apagada; eventuais correções devem gerar outro lançamento compensatório auditável.
