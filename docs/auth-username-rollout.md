# Rollout de autenticação por nome de usuário

A autenticação reconstruída permanece **desabilitada por padrão**. Somente o valor literal
`AUTH_USERNAME_ROLLOUT_ENABLED=true`, configurado fora do repositório, habilita login,
criação de identidades e gestão protegida de senhas. Não existe fallback por e-mail.

## Configuração server-side

- `AUTH_USERNAME_ROLLOUT_ENABLED`: barreira final, habilitada somente após todos os passos abaixo.
- `AUTH_RATE_LIMIT_SECRET`: segredo aleatório server-side com pelo menos 32 caracteres; nunca usar
  prefixo `NEXT_PUBLIC_`.
- `APP_ALLOWED_ORIGINS`: origins exatos separados por vírgula, sem path, wildcard, query ou fragmento.
- `SUPABASE_SERVICE_ROLE_KEY`: somente no servidor.
- `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`: configuração pública do SDK; não
  concedem privilégios administrativos.

## Ordem obrigatória

1. Aplicar a migration de expansão em ambiente autorizado e validar owner, grants, revokes e RLS.
2. Excluir os dados de teste somente em tarefa separada e formalmente autorizada.
3. Diagnosticar perfis órfãos e usuários Auth sem perfil, sem corrigi-los automaticamente.
4. Reconciliar cardinalidade e reservar usernames legítimos manualmente.
5. Fazer backfill controlado de `app_private.user_auth_state` apenas para identidades confirmadas.
6. Configurar origins e segredo do rate limiter em cada ambiente.
7. Executar os testes de integração listados em `lib/local-supabase.integration.blocked.ts`.
8. Habilitar a flag em uma janela controlada, com observabilidade e plano de reversão.

Desabilitar a flag interrompe novos fluxos sem tentar e-mail, sem criar estado parcial e sem alterar
dados existentes. A migration desta entrega não faz backfill, não toca identidades Auth e não trata
órfãos.
