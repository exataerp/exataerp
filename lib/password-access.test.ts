import assert from 'node:assert/strict'
import test from 'node:test'

import {
  REQUIRED_PASSWORD_CHANGE_API_PATH,
  REQUIRED_PASSWORD_CHANGE_LOGOUT_PATH,
  REQUIRED_PASSWORD_CHANGE_PATH,
  REQUIRED_PASSWORD_CHANGE_SESSION_PATH,
  isRequiredPasswordChangePath,
} from './password-access.ts'

test('libera somente a página e a API necessárias à troca obrigatória', () => {
  assert.equal(isRequiredPasswordChangePath(REQUIRED_PASSWORD_CHANGE_PATH), true)
  assert.equal(isRequiredPasswordChangePath(REQUIRED_PASSWORD_CHANGE_API_PATH), true)
  assert.equal(isRequiredPasswordChangePath(REQUIRED_PASSWORD_CHANGE_SESSION_PATH), true)
  assert.equal(isRequiredPasswordChangePath(REQUIRED_PASSWORD_CHANGE_LOGOUT_PATH), true)
  assert.equal(isRequiredPasswordChangePath('/'), false)
  assert.equal(isRequiredPasswordChangePath('/api/usuarios'), false)
  assert.equal(isRequiredPasswordChangePath('/primeiro-acesso/indevido'), false)
})
