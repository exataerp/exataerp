import assert from 'node:assert/strict'
import test from 'node:test'

import {
  TENANT_SLUG_HEADER,
  requestMatchesCompanyTenant,
  suggestTenantSlug,
  tenantSlugFromHostname,
  validateTenantSlug,
  withTrustedTenantHeader,
} from './tenant-host.ts'

test('extrai somente subdomínios diretos do domínio raiz configurado', () => {
  assert.equal(tenantSlugFromHostname('mairo.exataerp.com', 'exataerp.com'), 'mairo')
  assert.equal(tenantSlugFromHostname('FORZA.exataerp.com:443', 'exataerp.com'), 'forza')
  assert.equal(tenantSlugFromHostname('exataerp.com', 'exataerp.com'), null)
  assert.equal(tenantSlugFromHostname('www.exataerp.com', 'exataerp.com'), null)
  assert.equal(tenantSlugFromHostname('forza.exataerp.com.evil', 'exataerp.com'), null)
  assert.equal(tenantSlugFromHostname('nested.forza.exataerp.com', 'exataerp.com'), null)
})

test('remove cabeçalho de tenant enviado pelo cliente e injeta apenas o valor confiável', () => {
  const inbound = new Headers({ [TENANT_SLUG_HEADER]: 'forjado' })
  assert.equal(withTrustedTenantHeader(inbound, 'mairo').get(TENANT_SLUG_HEADER), 'mairo')
  assert.equal(withTrustedTenantHeader(inbound, null).get(TENANT_SLUG_HEADER), null)
})

test('valida o vínculo entre host e empresa mantendo o domínio legado compatível', () => {
  const tenantRequest = new Request('https://mairo.exataerp.com', {
    headers: { [TENANT_SLUG_HEADER]: 'mairo' },
  })
  assert.equal(requestMatchesCompanyTenant(tenantRequest, 'mairo'), true)
  assert.equal(requestMatchesCompanyTenant(tenantRequest, 'forza'), false)
  assert.equal(requestMatchesCompanyTenant(new Request('https://exataerp.vercel.app'), 'forza'), true)
})

test('gera sugestão previsível e rejeita nomes reservados ou inválidos', () => {
  assert.equal(suggestTenantSlug('Mairó Têxtil Ltda.'), 'mairo')
  assert.equal(suggestTenantSlug('FORZA IMPLEMENTOS'), 'forza')
  assert.equal(validateTenantSlug('mairo'), null)
  assert.match(validateTenantSlug('admin') ?? '', /reservado/)
  assert.match(validateTenantSlug('nome_invalido') ?? '', /apenas/)
})
