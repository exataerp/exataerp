import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ROLES,
  podeIniciarMultiplosApontamentos,
  type RoleName,
} from './permissions.ts'

test('administrador pode iniciar múltiplos apontamentos', () => {
  assert.equal(
    podeIniciarMultiplosApontamentos([ROLES.SYSTEM_MANAGER]),
    true,
  )
})

test('PCP pode iniciar múltiplos apontamentos', () => {
  assert.equal(
    podeIniciarMultiplosApontamentos([ROLES.PRODUCTION_MANAGER]),
    true,
  )
})

test('demais perfis continuam limitados a um apontamento ativo', () => {
  const perfisLimitados: RoleName[] = [
    ROLES.PRODUCTION_USER,
    ROLES.MAINTENANCE_MANAGER,
    ROLES.MAINTENANCE_USER,
    ROLES.STOCK_MANAGER,
    ROLES.STOCK_USER,
    ROLES.QUALITY_MANAGER,
    ROLES.VIEWER,
  ]

  for (const perfil of perfisLimitados) {
    assert.equal(podeIniciarMultiplosApontamentos([perfil]), false)
  }
})
