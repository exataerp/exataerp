# Validação pós-deploy — estabilização e exclusão de OP

Data: 2026-08-04

Ambiente: `https://exataerp.vercel.app`

Usuário autenticado: Tiago Prado (`ecd70f28-8a0b-4cc6-b107-f332673145b8`)

Tenant: FORZA IMPLEMENTOS (`00000000-0000-0000-0000-000000000001`)

## Publicação auditada

| Evidência | Valor |
|---|---|
| branch | `audit/integridade-fluxo-exata` |
| commit da correção | `7d3144ce4070024ace247f6a01c0ead6aa78754e` |
| pull request | `https://github.com/exataerp/exataerp/pull/24` |
| merge de produção | `e6fd2e0d6cd1969c3c1000de6ce58e70d138be64` |
| diferença de árvore entre correção e merge | nenhuma; o merge acrescenta somente o commit de integração |
| status Vercel do merge | `success` |
| deploy Vercel | `https://vercel.com/exata-erp/exataerp/HmBXqDNQ3qE89bwmXEf9Xp3Q5TqP` |
| URL pública | `https://exataerp.vercel.app` |

Antes da publicação passaram 73/73 testes, typecheck, lint com 0 erros e 16 avisos preexistentes, build Next.js 16.2.9, `git diff --check` e varredura de segredos.

## Cenários A–I do pedido original

Esta tabela usa as definições do texto original: A inválido; B início normal; C duplo clique; D cinco operações; E parcial; F refugo; G tempo de ciclo; H encerramento/estorno; I multitenant. Não confundir com a nomenclatura intermediária usada no relatório anterior.

| Cenário | Contexto/evidência executada | Resultado | Situação |
|---|---|---|---|
| A — apontamento inválido | Na UI publicada foi selecionado apenas `MONT-01`, sem OP/operação. Consulta posterior encontrou 0 apontamentos criados após a seleção. | Nenhuma escrita produtiva. | aprovado |
| B — início normal | A UI recuperou após reload o apontamento `bd2b4f19-7819-4f38-8ba2-c2b21205cda3`, OP `FZ-OP-0005`, operação Usinagem de acabamento, máquina `TORNO-CNC-19`; cronômetro avançou e SQL confirmou um único registro no contexto. | Recuperação e ausência de duplicidade aprovadas; o início não foi criado do zero nesta rodada. | parcial |
| C — duplo clique | Idempotência e proteção de dupla requisição passaram em testes automatizados e no banco. | Falta o duplo clique em um início novo no frontend publicado. | pendente publicado |
| D — OP com cinco operações | Consolidação por snapshot passou em teste automatizado/banco. | Falta executar 100 peças em cinco operações pela UI publicada e conferir estoque/OEE. | pendente publicado |
| E — apontamento parcial | Soma 40 + 60 passou em teste automatizado/banco. | Falta ciclo fresco autenticado no frontend publicado. | pendente publicado |
| F — refugo | Rastreabilidade 95 + 5 passou em teste automatizado/banco. | Falta ciclo fresco autenticado e conferência visual de todos os indicadores. | pendente publicado |
| G — tempo de ciclo | Produto 2040 tem teste exato para 88 s, 6 operações e média 14,67 s. | Falta registrar a prova visual no frontend publicado. | pendente publicado |
| H — encerramento e estorno | RPC transacional, reversões e auditoria passaram em testes automatizados/banco. | Falta ciclo fresco completo no frontend publicado e conferência visual cruzada. | pendente publicado |
| I — isolamento multitenant | RLS/RPC e OP-08 passaram com contexto autenticado de tenants diferentes. | Falta uma segunda sessão real de usuário pela UI publicada. | pendente publicado |

Não foram criados ciclos produtivos artificiais persistentes para forçar a aprovação visual de C–I. Pela regra implantada, esses registros passariam a ser histórico imutável; poluir produção para completar uma planilha de testes seria incompatível com a própria correção.

## Testes OP-01–09

| Teste | Usuário/tenant | OP e contexto | Resultado obtido | Evidência |
|---|---|---|---|---|
| OP-01 | Tiago Prado/FORZA | `CODEX-UI-OP01-20260804-1408`, `PA-BAL-0001` | Exclusão confirmada pela UI com motivo obrigatório; OP ausente; 0 snapshots órfãos. | audit `01f3c6f5-c23a-4329-80c4-5d60b2a096ab`, código `OP_DRAFT_DELETED`, 10 operações + 10 itens BOM preservados no log |
| OP-02 | administrador/FORZA | OP com apontamento ativo; evidência visual em `FZ-OP-0005` | Bloqueada; diálogo mostrou totais, usuário, datas, pausas/refugo/movimentos/eventos/OEE e abriu Auditoria. | UI publicada + transação autenticada de banco |
| OP-03 | administrador/FORZA | OP isolada com apontamento pausado | Bloqueada; registros permaneceram íntegros. | transação autenticada revertida |
| OP-04 | administrador/FORZA | OP isolada com apontamento finalizado | Bloqueada; finalização não liberou exclusão. | transação autenticada revertida |
| OP-05 | administrador/FORZA | OP isolada com apontamento estornado | Bloqueada pela política estrita: qualquer apontamento preservado impede exclusão física. | transação autenticada revertida |
| OP-06 | administrador/FORZA | OP isolada com movimento remanescente | Bloqueada; nenhum movimento órfão. | transação autenticada revertida |
| OP-07 | Tiago Prado/FORZA | `CODEX-OP07-20260804-1425`, primeira operação, primeira máquina do snapshot | Duas sessões reais: início segurou o lock por 2 s; exclusão aguardou; ambas reverteram; 0 apontamentos e 0 eventos após a corrida. | timestamps UTC 14:29:49/14:29:51; dado de teste limpo pela RPC, audit `3f123f13-441f-4dcb-aeab-de744d5616a7` |
| OP-08 | administradores de tenants distintos | OP isolada | Acesso cruzado negado. | transação autenticada revertida |
| OP-09 | banco | `DELETE` direto em OP com dependências | Trigger/FKs bloquearam; registros permaneceram; zero `CASCADE` destrutivo relevante no catálogo. | transação revertida + consulta ao catálogo |

Os testes OP-01–09 estão aprovados na camada correspondente. OP-01/02 possuem prova visual no frontend publicado; OP-03–09 são regras transacionais/de concorrência/tenant/banco e foram exercitados diretamente em produção com rollback quando aplicável.

## Critério final

O frontend e o banco corrigidos estão em produção e a regra crítica de exclusão está protegida de ponta a ponta. Ainda assim, a estabilização total **não** é declarada concluída porque:

1. B ainda precisa de um início fresco; C–I ainda precisam da regressão autenticada completa no frontend publicado;
2. a reconstrução de um banco vazio continua em `MIGRATIONS_FAILED`, conforme `docs/RECONCILIACAO_MIGRATIONS.md`;
3. falta a decisão operacional sobre o apontamento ativo legado de Rodrigo Zin;
4. a proteção contra senhas vazadas e os demais advisors classificados ainda dependem da decisão indicada em `docs/SEGURANCA_ADVISORS.md`.
