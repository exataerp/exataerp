import assert from 'node:assert/strict'
import test from 'node:test'

import { ALL_AUDIT_PERMISSIONS } from './audit.ts'
import { mergeAuditPermissions } from './auth-permissions.ts'

test('combina permissões de papel e de usuário sem duplicatas', () => {
  assert.deepEqual(
    mergeAuditPermissions(
      ['production_manager'],
      ['auditoria.visualizar', 'auditoria.exportar', 'override_scheduled_break'],
      ['auditoria.visualizar', 'estoque.editar'],
    ),
    ['auditoria.visualizar', 'auditoria.exportar'],
  )
})

test('system manager recebe o contrato completo de permissões de auditoria', () => {
  assert.deepEqual(
    mergeAuditPermissions(['system_manager'], [], []).sort(),
    [...ALL_AUDIT_PERMISSIONS].sort(),
  )
})
