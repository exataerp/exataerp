# Classificação de segurança e advisors

Execução pós-DDL: 2026-08-04
Projeto: `rcdhpodokmupsheycfse`

Referências: [Database Linter](https://supabase.com/docs/guides/database/database-linter), [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) e [Produção](https://supabase.com/docs/guides/deployment/going-into-prod).

## Resultado atual

| Advisor | Base auditada | Atual | Classificação | Risco | Tratamento |
|---|---:|---:|---|---|---|
| `SECURITY DEFINER` executável por `authenticated` | 14 | 17 | dependência funcional, revisão obrigatória | alto se faltar validação interna | manter somente RPCs públicas necessárias; mover helpers para `private`; testar todos os papéis antes de revogar |
| FKs sem índice | 23 | 23 | correção posterior | médio, desempenho/locks | medir cardinalidade e planos; criar índices concorrentes em janela própria |
| políticas com `auth.*` reavaliado por linha | 5 | 5 | correção posterior de baixo risco | médio em tabelas grandes | substituir por `(select auth.uid())`/equivalente em migration isolada e comparar planos |
| conjuntos de políticas permissivas sobrepostas | 4 | 4 | dependência funcional a consolidar | médio | provar equivalência por papel antes de unir políticas |
| índices sem uso observado | 21 | 25 | não remover agora; quatro índices são recentes | baixo custo de escrita hoje, risco alto se remoção cega | observar por ciclo representativo e após reinícios; revisar consumidores e FKs |
| proteção de senha vazada | desabilitada | desabilitada | correção imediata no Auth | alto para credenciais reutilizadas | habilitar no painel/Auth e testar cadastro, troca e recuperação de senha |

Os advisors também informam três tabelas com RLS habilitado e sem política (`codigos_acesso`, `super_admins`, `user_invitations`). RLS sem política nega acesso pela API; classificado como informativo enquanto os fluxos administrativos permanecerem exclusivamente server-side. Há ainda a recomendação informativa de alocação percentual de conexões do Auth.

## Funções privilegiadas atuais

| Grupo | Funções | Decisão |
|---|---|---|
| Produção transacional | `iniciar_apontamento_no_posto`, `pausar_apontamento_manual`, `retomar_apontamento`, `finalizar_apontamento_producao`, `finalizar_apontamento_estoque` | dependência funcional; manter apenas com sessão, tenant, locks e validações internas; regressão por papel obrigatória |
| Auditoria/estorno | `listar_auditoria_sistema`, `obter_detalhes_auditoria`, `minhas_permissoes_auditoria`, `estornar_apontamento_auditoria` | dependência funcional; alto impacto; manter checagem explícita de permissão e idempotência |
| Exclusão de OP | `excluir_ordem_producao_segura`, `cancelar_ou_excluir_ordem_producao` | nova RPC canônica e ponte temporária; ambas checam administrador/tenant; retirar a ponte após monitoramento |
| Roteiro/BOM | `salvar_roteiro_produto` | dependência funcional; versionamento atômico; manter autorização de gestor e auditoria |
| Contexto/autorização | `get_empresa_do_usuario`, `get_meu_perfil`, `is_master`, `meus_postos_trabalho`, `tem_acesso_empresa` | candidatas a `SECURITY INVOKER` ou schema privado; alteração posterior após mapear todos os chamadores |

O aumento de 14 para 17 decorre das RPCs adicionadas na estabilização e torna a revisão mais importante; não é tratado como falso positivo global. A exposição é intencional somente quando a função é o limite transacional da aplicação. Helpers não devem permanecer expostos por conveniência.

## Testes necessários antes de reduzir privilégios

1. Matriz `anon`, operador, PCP, produção, estoque, qualidade, administrador de empresa e master.
2. Tenant próprio, tenant alheio e UUID inexistente.
3. Chamadas válidas, repetidas e simultâneas.
4. Verificação de RLS, grants e validação interna da função.
5. Comparação de planos/latência antes e depois de políticas ou índices.
6. Testes de login, cadastro, troca e recuperação após habilitar proteção de senha vazada.

Nenhum índice ou privilégio foi removido apenas por recomendação automática.
