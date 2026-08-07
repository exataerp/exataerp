/**
 * BLOCKED_REQUIRES_LOCAL_SUPABASE
 *
 * Manifesto deliberadamente fora da suíte unitária: mocks não comprovam estas garantias.
 * Execute apenas contra Supabase local descartável, nunca contra produção ou homologação.
 */
export const BLOCKED_REQUIRES_LOCAL_SUPABASE = [
  'migration-clean-application',
  'migration-partial-application-diagnosis',
  'sql-functions-and-fixed-search-path',
  'owners-grants-and-revokes',
  'rls-default-deny',
  'row-locks-and-postgresql-concurrency',
  'postgres-persistent-rate-limit',
  'username-reservation-during-compensation',
  'real-gotrue-password-authentication',
  'host-only-ssr-cookies',
  'old-jwt-rejection',
  'refresh-token-revocation',
  'distributed-gotrue-postgres-compensation',
] as const
