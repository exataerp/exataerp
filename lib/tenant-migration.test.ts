import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(
  new URL('../supabase/migrations/20260808013000_empresas_subdominio.sql', import.meta.url),
  'utf8',
)

test('migração reserva subdomínios únicos e preenche os clientes existentes', () => {
  assert.match(migration, /add column if not exists subdomain text/)
  assert.match(migration, /then 'forza'/)
  assert.match(migration, /then 'mairo'/)
  assert.match(migration, /alter column subdomain set not null/)
  assert.match(migration, /unique index if not exists empresas_subdomain_lower_key/)
  assert.match(migration, /subdomain not in \('admin', 'api', 'app', 'homologacao', 'www'\)/)
})
