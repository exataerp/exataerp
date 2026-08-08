import assert from 'node:assert/strict'
import test from 'node:test'

import { compensateAndClassify } from './identity-compensation.ts'

test('failed exige confirmação de que nenhum estado residual permaneceu', async () => {
  assert.equal(
    await compensateAndClassify([async () => {}], [async () => false, async () => false]),
    'failed',
  )
})

test('compensation_required depende do estado residual e não da tentativa de escrita', async () => {
  assert.equal(
    await compensateAndClassify([async () => {}], [async () => true]),
    'compensation_required',
  )
  assert.equal(
    await compensateAndClassify([async () => { throw new Error('cleanup response lost') }], [async () => false]),
    'failed',
  )
})

test('falha ao verificar ausência mantém reconciliação obrigatória', async () => {
  assert.equal(
    await compensateAndClassify([], [async () => { throw new Error('probe unavailable') }]),
    'compensation_required',
  )
})
