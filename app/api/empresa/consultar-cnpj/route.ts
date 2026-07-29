import { NextResponse } from "next/server"

import { cnpjValido, formatarCnpj, limparCnpj } from "@/lib/cnpj"
import {
  assertSystemManager,
  AuthError,
  getUserFromToken,
  supabaseAdmin,
} from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

interface BrasilApiCnpj {
  cnpj?: string
  razao_social?: string
  nome_fantasia?: string
  descricao_situacao_cadastral?: string
  descricao_tipo_de_logradouro?: string
  logradouro?: string
  numero?: string
  complemento?: string
  bairro?: string
  municipio?: string
  uf?: string
  cep?: string
  cnae_fiscal_descricao?: string
  email?: string
  ddd_telefone_1?: string
}

function formatarCep(value?: string) {
  const cep = value?.replace(/\D/g, "") ?? ""
  return cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep
}

function montarEndereco(data: BrasilApiCnpj) {
  const tipoLogradouro = data.descricao_tipo_de_logradouro?.trim() ?? ""
  const nomeLogradouro = data.logradouro?.trim() ?? ""
  const logradouro =
    tipoLogradouro && !nomeLogradouro.toUpperCase().includes(tipoLogradouro.toUpperCase())
      ? `${tipoLogradouro} ${nomeLogradouro}`.trim()
      : nomeLogradouro
  const numero = data.numero?.trim()
  const complemento = data.complemento?.trim()
  const bairro = data.bairro?.trim()
  const cidadeUf = [data.municipio?.trim(), data.uf?.trim()].filter(Boolean).join("/")
  const cep = formatarCep(data.cep)

  return [
    [logradouro, numero].filter(Boolean).join(", "),
    complemento,
    bairro,
    cidadeUf,
    cep ? `CEP ${cep}` : "",
  ]
    .filter(Boolean)
    .join(" - ")
}

export async function POST(request: Request) {
  try {
    const user = await getUserFromToken(request)
    const body = await request.json()
    const cnpj = limparCnpj(String(body.cnpj ?? ""))

    if (!cnpjValido(cnpj)) {
      return NextResponse.json({ error: "Informe um CNPJ válido." }, { status: 400 })
    }

    const { data: perfil, error: perfilError } = await supabaseAdmin
      .from("perfis")
      .select("empresa_id")
      .eq("user_id", user.id)
      .single()

    if (perfilError || !perfil?.empresa_id) {
      return NextResponse.json({ error: "Empresa não encontrada." }, { status: 404 })
    }

    await assertSystemManager(user.id, perfil.empresa_id)

    let response: Response
    try {
      response = await fetch(
        `https://brasilapi.com.br/api/cnpj/v1/${encodeURIComponent(cnpj)}`,
        {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(12000),
          next: { revalidate: 86400 },
        },
      )
    } catch {
      return NextResponse.json(
        { error: "A consulta de CNPJ está temporariamente indisponível. Tente novamente." },
        { status: 503 },
      )
    }

    if (response.status === 404) {
      return NextResponse.json(
        { error: "CNPJ não encontrado na base pública da Receita Federal." },
        { status: 404 },
      )
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: "Não foi possível consultar o CNPJ agora. Tente novamente em instantes." },
        { status: response.status === 429 ? 429 : 502 },
      )
    }

    const data = (await response.json()) as BrasilApiCnpj
    const razaoSocial = data.razao_social?.trim() ?? ""
    const nomeFantasia = data.nome_fantasia?.trim() ?? ""
    const nome = nomeFantasia || razaoSocial
    const endereco = montarEndereco(data)
    const cnpjFormatado = formatarCnpj(data.cnpj ?? cnpj)

    if (!nome || !cnpjFormatado) {
      return NextResponse.json(
        { error: "A fonte pública retornou dados incompletos para este CNPJ." },
        { status: 502 },
      )
    }

    const empresaAtualizada = {
      nome,
      nome_fantasia: nomeFantasia || null,
      razao_social: razaoSocial || null,
      cnpj: cnpjFormatado,
      email: data.email?.trim().toLowerCase() || null,
      telefone: data.ddd_telefone_1?.trim() || null,
      cidade: data.municipio?.trim() || null,
      estado: data.uf?.trim() || null,
      endereco: endereco || null,
      segmento: data.cnae_fiscal_descricao?.trim() || null,
      onboarding_completed: true,
    }

    const { data: updatedRows, error: updateError } = await supabaseAdmin
      .from("empresas")
      .update(empresaAtualizada)
      .eq("id", perfil.empresa_id)
      .select("id")

    if (updateError || updatedRows?.length !== 1) {
      throw new Error(
        updateError
          ? `Erro ao atualizar a empresa: ${updateError.message}`
          : "Empresa não encontrada para atualização."
      )
    }

    return NextResponse.json({
      success: true,
      empresa: {
        ...empresaAtualizada,
        situacao_cadastral: data.descricao_situacao_cadastral?.trim() || null,
      },
      fonte: "Dados públicos do CNPJ via BrasilAPI",
    })
  } catch (error: any) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json(
      { error: error?.message ?? "Erro inesperado ao consultar o CNPJ." },
      { status: 500 },
    )
  }
}
