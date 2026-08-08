import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(
  new URL('../supabase/migrations/20260807020000_estado_privado_autenticacao_username.sql', import.meta.url),
  'utf8',
)

const publicUsernameMigration = readFileSync(
  new URL('../supabase/migrations/20260806115051_login_por_nome_de_usuario.sql', import.meta.url),
  'utf8',
)

const outboxIndexMigration = readFileSync(
  new URL('../supabase/migrations/20260807022000_index_identity_audit_outbox_operation_id.sql', import.meta.url),
  'utf8',
)

const authStateFixMigration = readFileSync(
  new URL('../supabase/migrations/20260807023000_corrige_ambiguidade_upsert_auth_state.sql', import.meta.url),
  'utf8',
)

test('migration history keeps the already-applied public username step separate', () => {
  assert.match(publicUsernameMigration, /add column if not exists username text/)
  assert.match(publicUsernameMigration, /perfis_username_lower_key/)
  assert.doesNotMatch(publicUsernameMigration, /app_private/)
  assert.doesNotMatch(publicUsernameMigration, /must_change_password|password_changed_at|password_reset_required_at/)
})

test('migration is expansion-only and keeps authentication state private', () => {
  assert.match(migration, /create schema app_private/)
  for (const table of ['user_auth_state', 'identity_operations', 'auth_rate_limits', 'identity_audit_outbox']) {
    assert.match(migration, new RegExp(`create table app_private\\.${table}`))
    assert.match(migration, new RegExp(`alter table app_private\\.${table} enable row level security`))
  }
  assert.doesNotMatch(migration, /\bupdate\s+(?:public\.)?perfis\b/i)
  assert.doesNotMatch(migration, /\balter\s+table\s+public\.perfis\b/i)
  assert.doesNotMatch(migration, /\bauth\.users\b/i)
  assert.doesNotMatch(migration, /create\s+(?:schema|table|function|index)\s+if\s+not\s+exists/i)
})

test('username is canonical, globally unique and reserved during uncertain compensation', () => {
  assert.match(migration, /username=lower\(btrim\(username\)\)/)
  assert.match(migration, /\^\[a-z0-9\]\[a-z0-9\._-\]\{2,39\}\$/)
  assert.match(migration, /unique index user_auth_state_username_key/)
  assert.match(migration, /status in\('pending','compensation_required'\)/)
})

test('idempotency key owns one operation and rejects a different payload', () => {
  assert.match(migration, /idempotency_digest text not null,request_fingerprint text not null/)
  assert.match(migration, /unique\(operation_type,empresa_id,actor_user_id,idempotency_digest\)/)
  assert.match(migration, /request_fingerprint is distinct from p_request_fingerprint/)
  assert.match(migration, /idempotency payload mismatch/)
})

test('all privileged functions are fixed-search-path and service-role only', () => {
  const functions = [
    'resolve_login_username',
    'get_private_auth_state',
    'consume_auth_rate_limit',
    'begin_identity_operation',
    'upsert_private_auth_state',
    'finish_identity_operation',
  ]
  for (const name of functions) {
    assert.match(migration, new RegExp(`create function public\\.${name}`))
    assert.match(migration, new RegExp(`alter function public\\.${name}[\\s\\S]*? owner to postgres`))
  }
  assert.match(migration, /security definer set search_path=pg_catalog/g)
  assert.match(migration, /revoke all on function[\s\S]+from public,anon,authenticated/)
  assert.match(migration, /grant execute on function[\s\S]+to service_role/)
  assert.doesNotMatch(migration, /execute\s+format/i)
})

test('completion locks state and operation and inserts the outbox in the same function', () => {
  const body = migration.slice(
    migration.indexOf('create function public.upsert_private_auth_state'),
    migration.indexOf('create function public.finish_identity_operation'),
  )
  assert.match(body, /identity_operations where id=p_operation_id and status='pending' for update/)
  assert.match(body, /user_auth_state where user_id=p_user_id for update/)
  assert.match(body, /state version conflict/)
  assert.match(body, /insert into app_private.identity_audit_outbox/)
  assert.match(body, /o\.operation_type='create_tenant_admin'[\s\S]*'empresa_id',o\.empresa_id/)
  assert.match(body, /o\.operation_type='create_user'[\s\S]*'requires_password_change',true/)
})

test('private JSON rejects common sensitive keys and has size limits', () => {
  for (const key of ['password', 'senha', 'token', 'access_token', 'refresh_token', 'email', 'technical_email']) {
    assert.match(migration, new RegExp(`'${key}'`))
  }
  assert.match(migration, /octet_length\(result::text\)<=4096/)
  assert.match(migration, /octet_length\(payload::text\)<=2048/)
})

test('identity audit outbox foreign key has a covering index', () => {
  assert.match(outboxIndexMigration, /identity_audit_outbox_operation_id_idx/)
  assert.match(outboxIndexMigration, /identity_audit_outbox \(operation_id\)/)
})

test('upsert qualifies identity operation state version', () => {
  assert.match(authStateFixMigration, /update app_private\.identity_operations as io set/)
  assert.match(authStateFixMigration, /state_version=io\.state_version\+1/)
})
