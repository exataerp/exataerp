import assert from 'node:assert/strict'
import test from 'node:test'

import {
  REQUIRED_PASSWORD_CHANGE_API_PATH,
  REQUIRED_PASSWORD_CHANGE_LOGOUT_PATH,
  REQUIRED_PASSWORD_CHANGE_PATH,
  REQUIRED_PASSWORD_CHANGE_SESSION_PATH,
  isPublicAuthApiPath,
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

test('APIs de autenticação preservam respostas JSON mesmo com sessão ativa', () => {
  assert.equal(isPublicAuthApiPath('/api/auth/session'), true)
  assert.equal(isPublicAuthApiPath('/api/auth/logout'), true)
  assert.equal(isPublicAuthApiPath('/api/auth/change-password'), true)
  assert.equal(isPublicAuthApiPath('/api/auth/login'), true)
  assert.equal(isPublicAuthApiPath('/api/auth/me'), true)
  assert.equal(isPublicAuthApiPath('/'), false)
  assert.equal(isPublicAuthApiPath('/api/usuarios'), false)
})
