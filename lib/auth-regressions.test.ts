import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  HOMOLOG_ADMIN_UID,
  HOMOLOG_ADMIN_USERNAME,
  HOMOLOG_ORIGIN,
  HOMOLOG_SUPABASE_URL,
  homologBootstrapAccessStatus,
  initialHomologAdminBootstrapVersions,
} from './homolog-admin-bootstrap.ts'

const source = (relativePath: string) => readFileSync(
  new URL(`../${relativePath}`, import.meta.url),
  'utf8',
)

test('middleware deixa APIs de autenticação responderem sem redirect HTML', () => {
  const middleware = source('middleware.ts')
  assert.match(middleware, /if \(isPublicAuthApiPath\(pathname\)\) return supabaseResponse/)

  const access = source('lib/password-access.ts')
  for (const path of ['/api/auth/session', '/api/auth/logout', '/api/auth/change-password']) {
    assert.match(access, new RegExp(path.replaceAll('/', '\\/')))
  }
})

test('sessão entrega o contrato completo e falha quando consultas falham', () => {
  const session = source('app/api/auth/session/route.ts')
  for (const field of ['user', 'empresa', 'roles', 'permissions', 'preferencias']) {
    assert.match(session, new RegExp(`${field}:?`))
  }
  for (const checkedError of [
    'profileResult.error',
    'companyResult.error',
    'preferencesResult.error',
    'roleLinksResult.error',
    'userPermissionsResult.error',
    'rolePermissionsResult.error',
  ]) assert.ok(session.includes(checkedError), `erro ignorado: ${checkedError}`)
})

test('empresa é criada somente depois da reserva idempotente', () => {
  const route = source('app/api/admin/nova-fabrica/route.ts')
  const reservation = route.indexOf("rpc('begin_identity_operation'")
  const companyInsert = route.indexOf("from('empresas').insert")

  assert.ok(reservation >= 0)
  assert.ok(companyInsert > reservation)
  assert.match(route, /idempotentResourceId\(digest\)/)
  assert.match(route, /p_request_fingerprint: fingerprint/)
  assert.doesNotMatch(route, /partialDatabaseState/)
})

test('criações classificam falha pelo estado residual verificado', () => {
  const tenantRoute = source('app/api/admin/nova-fabrica/route.ts')
  const userRoute = source('app/api/usuarios/route.ts')
  for (const route of [tenantRoute, userRoute]) {
    assert.match(route, /compensateCreatedIdentity/)
    assert.doesNotMatch(route, /fullyCompensated|databaseWritesStarted/)
  }
})

test('consulta de permissões da equipe não ignora erro', () => {
  const route = source('app/api/admin/equipe/route.ts')
  assert.match(route, /if \(permissionsResult\.error\) throw permissionsResult\.error/)
})

test('criação mantém o username legado e inicia credential version no Auth', () => {
  for (const routePath of ['app/api/usuarios/route.ts', 'app/api/admin/nova-fabrica/route.ts']) {
    const route = source(routePath)
    assert.match(route, /login_identifier: 'username', credential_version: 1/)
    assert.match(route, /user_id: [^,]+, (?:empresa_id: [^,]+, )?username,/)
  }
})

test('troca de senha incrementa a credential version e o principal valida o token', () => {
  const ownPassword = source('app/api/auth/change-password/route.ts')
  const adminPassword = source('app/api/usuarios/[id]/senha/route.ts')
  const principal = source('lib/auth-principal.ts')

  assert.match(ownPassword, /credential_version: nextCredentialVersion/)
  assert.match(ownPassword, /first_access_completed: true/)
  assert.match(adminPassword, /credential_version: Number\(state\.credential_version\) \+ 1/)
  assert.match(principal, /credentialVersionFromAccessToken/)
  assert.match(principal, /credentialVersion !== verified\.credentialVersion/)
})

test('bootstrap da senha do administrador fica restrito à Preview de homologação', () => {
  const route = source('app/api/internal/homolog/bootstrap-admin-password/route.ts')
  const middleware = source('middleware.ts')

  const validAccess = {
    vercel: '1',
    vercelEnv: 'preview',
    supabaseUrl: HOMOLOG_SUPABASE_URL,
    origin: HOMOLOG_ORIGIN,
  }
  assert.equal(homologBootstrapAccessStatus(validAccess), null)
  assert.equal(homologBootstrapAccessStatus({ ...validAccess, vercelEnv: 'production' }), 404)
  assert.equal(homologBootstrapAccessStatus({ ...validAccess, supabaseUrl: 'https://production.supabase.co' }), 503)
  assert.equal(homologBootstrapAccessStatus({ ...validAccess, origin: 'https://example.com' }), 403)
  assert.equal(HOMOLOG_ADMIN_UID, '7e22ded1-7712-4b3c-acc8-222aed508b57')
  assert.equal(HOMOLOG_ADMIN_USERNAME, 'admin')
  assert.match(route, /homologBootstrapAccessStatus/)
  assert.match(middleware, /pathname === '\/api\/internal\/homolog\/bootstrap-admin-password'\) return NextResponse\.next\(\)/)
})

test('bootstrap aceita apenas o estado inicial one-shot do admin de homologação', () => {
  assert.deepEqual(initialHomologAdminBootstrapVersions({
    username: 'admin',
    credential_version: 1,
    state_version: 1,
    must_change_password: false,
  }), {
    credentialVersion: 1,
    stateVersion: 1,
    nextCredentialVersion: 2,
  })
  assert.equal(initialHomologAdminBootstrapVersions({
    username: 'admin',
    credential_version: 2,
    state_version: 2,
    must_change_password: true,
  }), null)
  assert.equal(initialHomologAdminBootstrapVersions({
    username: 'outro',
    credential_version: 1,
    state_version: 1,
    must_change_password: false,
  }), null)
})

test('bootstrap valida a senha e mantém o estado de credenciais coerente', () => {
  const route = source('app/api/internal/homolog/bootstrap-admin-password/route.ts')

  assert.match(route, /readStrictJson<\{ password\?: unknown \}>\(request, \['password'\]\)/)
  assert.match(route, /validatePassword\(bootstrapPassword\)/)
  assert.match(route, /auth\.admin\.updateUserById\(HOMOLOG_ADMIN_UID/)
  assert.match(route, /credential_version: nextCredentialVersion/)
  assert.match(route, /p_expected_state_version: stateVersion/)
  assert.match(route, /p_must_change_password: true/)
  assert.match(route, /initialHomologAdminBootstrapVersions\(state\)/)

  const updateStart = route.indexOf('auth.admin.updateUserById')
  const updateEnd = route.indexOf('if (changed.error)', updateStart)
  assert.ok(updateStart >= 0 && updateEnd > updateStart)
  const updateCall = route.slice(updateStart, updateEnd)
  assert.match(updateCall, /password: bootstrapPassword/)
  assert.match(updateCall, /\.\.\.authUser\.data\.user\.app_metadata/)
  assert.doesNotMatch(updateCall, /\b(?:email|user_metadata|empresa_id|roles|permissions)\s*:/)
})

test('bootstrap não usa SQL Auth, senha fixa, service role direta ou logs de credenciais', () => {
  const route = source('app/api/internal/homolog/bootstrap-admin-password/route.ts')

  assert.doesNotMatch(route, /auth\.users/i)
  assert.doesNotMatch(route, /\b(?:bootstrapPassword|password)\s*=\s*['"`][^'"`]+/)
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY/)
  assert.doesNotMatch(route, /console\.(?:log|info|warn|error|debug)/)

  const fingerprintStart = route.indexOf('nonSensitiveFingerprint({')
  const fingerprintEnd = route.indexOf('})', fingerprintStart)
  assert.ok(fingerprintStart >= 0 && fingerprintEnd > fingerprintStart)
  assert.doesNotMatch(route.slice(fingerprintStart, fingerprintEnd), /\b(?:password|senha)\b/i)
})
