export function limparCnpj(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 14)
}

export function formatarCnpj(value: string) {
  const cnpj = limparCnpj(value)
  const partes = [
    cnpj.slice(0, 2),
    cnpj.slice(2, 5),
    cnpj.slice(5, 8),
    cnpj.slice(8, 12),
    cnpj.slice(12, 14),
  ]

  let resultado = partes[0]
  if (partes[1]) resultado += `.${partes[1]}`
  if (partes[2]) resultado += `.${partes[2]}`
  if (partes[3]) resultado += `/${partes[3]}`
  if (partes[4]) resultado += `-${partes[4]}`
  return resultado
}

function valorDoCaractere(caractere: string) {
  return caractere.charCodeAt(0) - 48
}

function calcularDigito(base: string, pesos: number[]) {
  const soma = base
    .split("")
    .reduce((total, caractere, indice) => total + valorDoCaractere(caractere) * pesos[indice], 0)
  const resto = soma % 11
  return resto < 2 ? 0 : 11 - resto
}

export function cnpjValido(value: string) {
  const cnpj = limparCnpj(value)
  if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj)) return false
  if (/^(.)\1{13}$/.test(cnpj)) return false

  const base = cnpj.slice(0, 12)
  const primeiroDigito = calcularDigito(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const segundoDigito = calcularDigito(`${base}${primeiroDigito}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])

  return cnpj.endsWith(`${primeiroDigito}${segundoDigito}`)
}
