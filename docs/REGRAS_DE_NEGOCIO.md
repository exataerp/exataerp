# Regras de negócio — produção, estoque e indicadores

## 1. Princípios

1. Toda escrita operacional pertence a uma empresa e deve validar a empresa do usuário autenticado.
2. Estados críticos mudam por RPC transacional, não por `insert`, `update` ou `delete` direto no frontend.
3. Identificadores históricos são imutáveis. Edição de roteiro cria versão; não recria o passado.
4. Registros operacionais não são apagados. Erros são estornados ou cancelados com trilha auditável.
5. Cálculos exibidos em telas diferentes usam a mesma função/fonte de verdade.
6. O legado incompatível é classificado antes de ser corrigido.

## 2. Produto e roteiro

- Uma operação pertence a um produto e a uma empresa.
- A sequência das operações ativas é única dentro de uma versão do roteiro.
- Tempo deve ser armazenado/normalizado em segundos; a unidade original pode ser preservada para auditoria.
- Uma versão de roteiro usada por ordem não pode ser alterada nem excluída.
- Alterar sequência, tempo, obrigatoriedade ou posto cria nova versão.
- A nova versão vale apenas para ordens liberadas depois de sua vigência, salvo replanejamento explícito e auditado.

## 3. Ordem de produção

- A ordem referencia produto por ID e preserva código/descrição como snapshot de apresentação.
- Ao liberar, a ordem recebe um snapshot do roteiro com operação, sequência, tempo, posto e obrigatoriedade.
- Uma ordem sem snapshot válido não pode iniciar.
- A quantidade acabada da ordem é a menor quantidade aprovada acumulada entre operações obrigatórias, limitada à quantidade planejada.
- Refugo é registrado por operação e não deve ser somado como produto acabado.
- A ordem só encerra quando todas as operações obrigatórias do snapshot estiverem concluídas e não houver apontamento ativo.
- Ordem com apontamento, movimento ou evento não pode ser excluída; deve ser cancelada/arquivada conforme autorização.

## 4. Início do apontamento

- Selecionar empresa, posto, máquina, ordem ou operação nunca inicia produção.
- O início exige ação explícita e confirmada do usuário.
- O comando possui identificador idempotente; repetir o mesmo comando retorna o mesmo resultado.
- Não pode existir mais de um apontamento ativo para o mesmo contexto empresa/usuário/ordem/operação/máquina.
- O limite adicional por usuário depende do papel, mas não elimina a unicidade do contexto.
- Ordem, operação do snapshot, máquina e usuário devem existir, estar ativos quando aplicável e pertencer à mesma empresa.
- O início grava evento com ator, origem `operador`, timestamp, contexto e identificador do comando.
- `cronometro_inicio` é um instante UTC; a apresentação usa o fuso da empresa.

## 5. Pausa e retomada

- Somente apontamento em execução pode ser pausado.
- Somente apontamento pausado ou aguardando retomada pode retomar.
- Pausa manual exige ator e motivo quando a política da empresa assim determinar.
- Pausa programada registra o evento programado que a originou.
- O fim do intervalo programado não inicia produção silenciosamente; muda para `aguardando_retomada` até ação explícita, salvo política formal diferente.
- Intervalos não podem se sobrepor e devem pertencer ao mesmo apontamento/empresa.
- Tempo líquido é a união dos intervalos em execução, nunca a simples diferença entre início e fim quando houve pausas.

## 6. Finalização

- A finalização trava apontamento, ordem e saldos afetados na mesma transação.
- Quantidade boa e refugo são não negativos.
- A quantidade informada deve respeitar os limites definidos para ordem/operação.
- Repetir uma finalização já confirmada não duplica produção nem estoque.
- O encerramento do apontamento grava ator, origem, timestamp e evento.
- A consolidação usa o snapshot da ordem.
- Falha em qualquer movimento de estoque reverte toda a finalização.

## 7. Estoque

- Crédito de produto acabado corresponde somente ao novo delta consolidado da ordem.
- Cinco operações reportando as mesmas 100 unidades resultam em no máximo 100 unidades acabadas, não 500.
- Cada movimento tem chave de idempotência e vínculo com empresa, ordem e apontamento.
- Movimentos confirmados são imutáveis; estorno cria movimento compensatório.
- Consumo de insumo segue a estrutura vigente/snapshot definida para a ordem.
- Saldo negativo só é permitido por regra explícita de empresa e deve ficar auditado.

## 8. Estorno

- Estorno exige permissão específica, motivo não vazio, ator e timestamp.
- O estorno é transacional: apontamento, consolidação da ordem, movimentos e saldos são revertidos em conjunto.
- Um apontamento não pode ser estornado duas vezes.
- Eventos e logs de auditoria não são removidos no estorno.
- Registros legados sem cadeia suficiente exigem procedimento administrativo separado.

## 9. Métricas industriais

### 9.1 Definições

- **Tempo de operação:** tempo padrão de uma etapa para uma unidade.
- **Tempo de ciclo total do roteiro:** soma dos tempos das etapas sequenciais para uma unidade.
- **Tempo médio de operação:** soma dos tempos dividida pelo número de operações; é descritivo, não substitui o total.
- **Gargalo:** recurso/etapa com maior carga ou menor capacidade no horizonte analisado.
- **Takt:** tempo produtivo disponível no período dividido pela demanda do período. Sem demanda e calendário, takt é “não calculável”.
- **Lead time:** tempo decorrido do início ao fim, incluindo filas e esperas conforme escopo declarado.

Para o produto 2040 no diagnóstico:

- tempos: 10 s, 7 s, 11 s, 31 s, 14 s e 15 s;
- total: 88 s;
- média: 14,67 s;
- gargalo nominal: 31 s;
- takt: não calculável apenas com esses tempos.

### 9.2 OEE

Para recurso e período definidos:

- disponibilidade = tempo em execução / tempo produtivo programado;
- desempenho = tempo ideal para as unidades processadas / tempo em execução;
- qualidade = unidades boas / unidades processadas;
- OEE = disponibilidade × desempenho × qualidade.

Regras adicionais:

- numerador e denominador devem usar o mesmo recurso, período, turno e empresa;
- peças que passam por várias operações não podem ser contadas como acabadas várias vezes;
- o tempo ideal usa o tempo da operação executada, não o ciclo total do produto;
- OEE agregado deve ser recalculado a partir dos totais compatíveis ou ponderado pela base temporal, nunca média simples de percentuais heterogêneos;
- registros órfãos, cancelados, estornados ou fora da janela não participam;
- o relatório deve expor período, fuso, filtros e fórmula.

## 10. Auditoria

- Eventos mínimos: criação/liberação/cancelamento de ordem; início/pausa/retomada/finalização/estorno; override de horário; movimento/estorno de estoque; alteração de roteiro.
- Cada evento registra empresa, entidade, ID, ator, origem, instante, correlação/idempotência e payload anterior/novo quando pertinente.
- “Sistema” só é origem válida para uma rotina automatizada identificada. Falta de informação deve aparecer como “origem não registrada (legado)”.
- Logs são append-only e acessíveis apenas aos papéis autorizados.

## 11. Fuso horário

- Instantes são armazenados em `timestamptz` UTC.
- Datas e horários de exibição usam `empresas.timezone`.
- Campos `time without time zone` representam somente horário civil planejado, nunca instante de evento.
- Filtros por dia convertem o intervalo civil da empresa para UTC antes da consulta.

## 12. Exclusão e inativação

| Objeto | Sem dependências | Com dependências |
|---|---|---|
| produto | exclusão opcional controlada | inativação |
| versão de roteiro | exclusão apenas em rascunho | imutável/inativa |
| máquina/posto | exclusão opcional controlada | inativação |
| ordem | exclusão apenas em rascunho sem eventos | cancelamento/arquivo |
| apontamento | nunca | estorno |
| movimento | nunca | compensação |

## 13. Concorrência e idempotência

- Operações críticas usam locks em ordem determinística: empresa/contexto, ordem, apontamento e saldos.
- Toda chamada mutável que possa ser repetida por rede/UI recebe `command_id` único por empresa.
- Constraints únicas são a última linha de defesa; checagens de frontend não substituem constraints.
- Erros de unicidade/idempotência retornam o resultado existente quando o comando é equivalente.
