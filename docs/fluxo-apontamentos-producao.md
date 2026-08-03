# Fluxo transacional de apontamentos de produção

## Decisão de consolidação

O Exata não possui uma instância persistida de cada operação por OP. A tabela
`operacoes` representa o roteiro mestre do produto e é compartilhada por todas
as ordens. Por isso, o estado de uma operação dentro de uma OP é derivado dos
apontamentos da combinação `empresa_id + ordem_id + operacao_id`; o roteiro
mestre não recebe um status de execução.

A view `ordem_operacoes_resumo` expõe esse estado derivado por OP/operação para
APIs e relatórios sem duplicar o roteiro nem misturar ordens diferentes.

A quantidade da OP usa a menor quantidade entre todas as operações
obrigatórias ativas do roteiro:

- `quantidade_produzida`: menor quantidade processada;
- `quantidade_aprovada`: menor quantidade processada menos refugo;
- apontamentos cancelados não entram no cálculo;
- operações com `ativo = false` ou `obrigatoria = false` não bloqueiam a OP.

Essa é a alternativa mais segura para o modelo atual porque não soma as mesmas
unidades em etapas diferentes e também funciona com operações paralelas. Uma OP
de 100 peças com cinco operações de 100 peças consolida 100, nunca 500.

Não havia no modelo uma situação de “operação do roteiro cancelada” separada de
um apontamento cancelado. A migration documenta e implementa a decisão
compatível: uma operação desativada ou opcional não bloqueia; um apontamento
cancelado é removido dos totais. A coluna `operacoes.obrigatoria` é aditiva e os
registros existentes recebem `true`.

## Estados e encerramento

A RPC `finalizar_apontamento_producao` separa os três conceitos:

1. finaliza uma única sessão de apontamento;
2. deriva o estado da operação a partir do acumulado de todos os operadores;
3. recalcula o conjunto completo do roteiro e somente então pode marcar a OP
   como `encerrada`.

Os nomes existentes foram preservados. Apontamentos finalizados parcialmente
continuam armazenados como `aberto`; os que completam a quantidade da operação,
como `fechado`. O retorno da RPC expõe `apontamento_status = finalizado` e também
`apontamento_status_banco` para deixar essa compatibilidade explícita.

A OP não encerra se houver uma operação obrigatória abaixo da quantidade
planejada, uma operação obrigatória com apontamento ativo, qualquer apontamento
ativo relacionado à OP ou nenhum roteiro obrigatório ativo. Um trigger na
própria `ordens_producao` rejeita tentativas de contornar essa regra.

## Concorrência, idempotência e auditoria

A finalização bloqueia o apontamento e a OP com `FOR UPDATE`. O trigger de limite
de quantidade também serializa finalizações da mesma ordem. Uma repetição com o
mesmo `apontamento_id` e as mesmas quantidades retorna o estado já persistido;
uma repetição com valores diferentes é rejeitada.

Apontamento, pausa aberta, totais da operação, consolidação da OP, estoque e
evento de auditoria são atualizados na mesma transação PostgreSQL. O histórico
`production_order_events` registra operador, horário, operação, quantidades,
status anterior/novo e reaberturas provocadas por edição ou cancelamento.

## Estoque e OEE

O estoque recebe somente o delta de `quantidade_aprovada` ainda não creditado.
A quantidade informada pelo navegador não define a entrada de produto acabado.
A assinatura antiga `finalizar_apontamento_estoque` foi preservada para clientes
já publicados, mas agora também usa o delta consolidado e continua idempotente.

Se uma correção ou um cancelamento reduzir uma quantidade que já foi creditada
ao estoque, a OP e os indicadores são recalculados automaticamente, mas a saída
física deve ser registrada por um movimento compensatório de estoque. O saldo
creditado é monotônico para impedir que uma nova finalização duplique entradas.

Dashboards gerais e relatórios de qualidade usam os campos consolidados da OP.
Visões por máquina/operação continuam somando o volume processado naquela etapa,
com rótulos que deixam claro que se trata de processamento operacional, não de
novos produtos acabados.

## Dados antigos e reversão

Na aplicação da migration, OPs existentes são recalculadas com o roteiro atual.
`concluida_em` usa a última data de apontamento disponível, e movimentos antigos
de produto acabado são usados para preencher `quantidade_aprovada_estoque`,
evitando nova entrada das mesmas peças.

Para reversão operacional:

1. restaurar o frontend anterior;
2. remover os triggers `ordens_producao_validar_encerramento` e
   `apontamentos_recalcular_op_*`;
3. restaurar as funções da migration
   `20260801195731_corrigir_finalizacao_apontamento_parcial.sql`;
4. manter as novas colunas, que são aditivas e preservam o histórico, ou removê-las
   somente após exportar os dados consolidados e confirmar que nenhum cliente as
   utiliza.
