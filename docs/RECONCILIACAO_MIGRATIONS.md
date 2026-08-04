# Reconciliação das migrations

Data: 2026-08-04
Projeto: `rcdhpodokmupsheycfse`

## Situação atual

O histórico local não reconstrói um banco vazio. A tentativa em branch Supabase isolado terminou em `MIGRATIONS_FAILED` e sem tabelas públicas. O branch foi descartado; o ledger de produção não foi alterado manualmente.

O ledger de produção atualmente termina em:

| Versão registrada | Nome |
|---|---|
| `20260804140122` | `preservar_eventos_producao` |
| `20260804135006` | `bloqueio_exclusao_op_com_apontamentos` |
| `20260804130930` | `indices_integridade_fluxo_exata` |
| `20260804125917` | `integridade_fluxo_exata` |
| `20260801235652` | `corrige_codificacao_utf8_forza` |

As versões registradas pelo Supabase não coincidem necessariamente com o timestamp do arquivo local criado pelo CLI. A identidade deve ser comprovada por nome, conteúdo normalizado e checksum; não apenas por horário ou presença de objetos parecidos.

## Risco

Classificação: crítico e ainda aberto. Um novo ambiente, recuperação de desastre ou branch de validação pode falhar antes de chegar ao schema vigente. Isso impede declarar a estabilização integral concluída, embora as migrations novas tenham sido testadas com rollback e aplicadas com sucesso no schema real.

## Plano controlado

1. Exportar, em modo somente leitura, schema, funções, triggers, políticas, grants, extensões e ledger de produção.
2. Calcular SHA-256 de cada arquivo local e de cada statement normalizado disponível no ledger.
3. Montar a correspondência `arquivo local → versão no ledger → objetos produzidos → checksum`.
4. Classificar divergências como: idêntica, equivalente após formatação, parcialmente aplicada, ausente ou conflitante.
5. Produzir uma migration-base canônica a partir do primeiro estado comprovado, sem editar migrations já aplicadas.
6. Criar banco vazio descartável e aplicar toda a sequência desde o início.
7. Exigir ausência de `MIGRATIONS_FAILED` e comparar o schema final com a assinatura canônica de produção.
8. Executar testes de banco, testes OP-01 a OP-09 e advisors.
9. Descartar e recriar novamente o ambiente para comprovar reprodutibilidade.
10. Submeter qualquer reconciliação do ledger a revisão humana independente e preservar backup/rollback.

## Critério de conclusão

- [ ] Banco vazio criado.
- [ ] Todas as migrations aplicadas sem `MIGRATIONS_FAILED`.
- [ ] Schema final equivalente ao esperado.
- [ ] Testes de banco aprovados.
- [ ] Advisors executados e classificados.
- [ ] Ambiente descartado e recriado novamente com sucesso.
- [ ] Checksum e revisão independente anexados.

Nenhuma versão deve ser inserida, removida ou marcada como aplicada no ledger sem checksum e revisão.
