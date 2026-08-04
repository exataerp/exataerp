# Ponte de compatibilidade das RPCs

Data: 2026-08-04

## Exclusão de Ordem de Produção

| Campo | Valor |
|---|---|
| Ponte | `public.cancelar_ou_excluir_ordem_producao(uuid, uuid, text)` |
| Assinatura antiga | `p_empresa_id`, `p_ordem_id`, `p_motivo` |
| RPC canônica nova | `public.excluir_ordem_producao_segura(uuid, uuid, text, boolean, uuid)` |
| Parâmetros novos | confirmação explícita e chave de idempotência |
| Tela antiga | frontend publicado antes desta correção, em PCP |
| Tela nova | `components/pcp-tab.tsx`, chamando apenas a RPC canônica |

A ponte chama a RPC canônica e transforma todo `success=false` em erro. Isso é deliberado: o frontend antigo removia a OP da memória quando a RPC retornava JSON sem erro. Assim, nenhum bloqueio pode parecer uma exclusão bem-sucedida na versão antiga.

Regras executadas: sessão válida, administrador autorizado, tenant, idempotência, locks, qualquer apontamento bloqueia, histórico/movimento bloqueia, somente rascunho limpo e motivo mínimo permitem exclusão. Toda tentativa bloqueada e toda exclusão aceita geram `audit_logs`.

Risco residual: a assinatura antiga não oferece confirmação separada nem chave fornecida pelo cliente. Ela gera UUID no servidor e deve existir somente durante a transição.

## Início de apontamento

| Campo | Valor |
|---|---|
| Assinatura antiga | seis argumentos, sem `p_command_id` |
| Assinatura nova | sete argumentos, incluindo `p_command_id uuid` |
| Tela antiga | frontend publicado anterior, protegido pela sobrecarga de seis argumentos |
| Tela nova | `components/apontamento-tab.tsx`, que envia `p_command_id` |

A assinatura antiga delega à nova com chave gerada no servidor. A tela nova fornece uma chave estável e obtém idempotência entre repetição/rede.

## Logs e monitoramento

- exclusão bloqueada: `audit_logs.action = 'order_delete_blocked'`;
- rascunho excluído: `audit_logs.action = 'order_deleted'`;
- início: `production_order_events.event_type = 'production_report_started'`;
- falhas da API: logs do PostgREST/Supabase e erros do frontend publicado.

## Plano de retirada

1. Publicar o frontend novo.
2. Confirmar no repositório e no bundle publicado a ausência de chamadas antigas.
3. Monitorar erros e chamadas RPC por uma janela operacional acordada.
4. Criar migration independente que revogue e remova somente as assinaturas antigas.
5. Executar regressão autenticada e teste de rollback.
6. Manter a migration de retirada reversível até o fim da janela.

A ponte não deve ser removida no mesmo deploy que troca o cliente.
