import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

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
