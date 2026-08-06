import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildInternalAuthEmail,
  normalizeOptionalEmail,
  normalizeUsername,
  validateOptionalEmail,
  validatePassword,
  validatePasswordChange,
  validateUsername,
} from './auth-credentials.ts'

test('normaliza nome de usuário sem convertê-lo em e-mail', () => {
  assert.equal(normalizeUsername('  Operador.Corte  '), 'operador.corte')
  assert.equal(validateUsername('operador_corte-1'), null)
  assert.match(validateUsername('jo') ?? '', /3 a 40/)
  assert.match(validateUsername('usuário') ?? '', /letras sem acento/)
})

test('valida a senha criada diretamente pelo administrador', () => {
  assert.equal(validatePassword('Segura@2026'), null)
  assert.match(validatePassword('curta') ?? '', /maiúscula/)
  assert.match(validatePassword('seml maiuscula@2026') ?? '', /maiúscula/)
  assert.match(validatePassword('SEM-MINUSCULA@2026') ?? '', /minúscula/)
  assert.match(validatePassword('SemNumero@') ?? '', /número/)
  assert.match(validatePassword('SemEspecial2026') ?? '', /especial/)
})

test('valida a troca de senha com senha atual e confirmação', () => {
  assert.deepEqual(validatePasswordChange('', '', ''), {
    currentPassword: 'Informe a senha atual.',
    newPassword: 'Senha é obrigatória.',
    confirmation: 'Confirme a nova senha.',
  })
  assert.deepEqual(validatePasswordChange('Atual@2026', 'Atual@2026', 'Atual@2026'), {
    newPassword: 'A nova senha deve ser diferente da senha atual.',
  })
  assert.deepEqual(validatePasswordChange('Atual@2026', 'Nova@2026', 'Outra@2026'), {
    confirmation: 'As senhas informadas não são iguais.',
  })
  assert.deepEqual(validatePasswordChange('Atual@2026', 'Nova@2026', 'Nova@2026'), {})
})

test('aceita e-mail de contato vazio e normaliza um e-mail informado', () => {
  assert.equal(normalizeOptionalEmail(''), null)
  assert.equal(normalizeOptionalEmail(' CONTATO@EMPRESA.COM '), 'contato@empresa.com')
  assert.equal(validateOptionalEmail(''), null)
  assert.match(validateOptionalEmail('invalido') ?? '', /e-mail válido/)
})

test('gera credencial Auth técnica em domínio que não recebe e-mails', () => {
  assert.equal(
    buildInternalAuthEmail('123e4567-e89b-12d3-a456-426614174000'),
    'user-123e4567-e89b-12d3-a456-426614174000@auth.exataerp.invalid',
  )
})
