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

interface OpenCnpjResponse {
  success?: boolean
  data?: {
    cnpj?: string
    razaoSocial?: string
    nomeFantasia?: string
    situacaoCadastral?: string
    logradouro?: string
    numero?: string
    complemento?: string
    bairro?: string
    municipio?: string
    uf?: string
    cep?: string
    cnaes?: Array<{ descricao?: string }>
    email?: string
    telefone?: string
  }
}

interface ConsultaCnpj {
  data: BrasilApiCnpj
  fonte: string
}

async function consultarCnpjPublico(cnpj: string): Promise<ConsultaCnpj | null> {
  try {
    const response = await fetch(
      `https://brasilapi.com.br/api/cnpj/v1/${encodeURIComponent(cnpj)}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "ExataERP/1.0",
        },
        signal: AbortSignal.timeout(12000),
        cache: "no-store",
      },
    )

    if (response.ok) {
      return {
        data: (await response.json()) as BrasilApiCnpj,
        fonte: "BrasilAPI",
      }
    }
  } catch {
    // Consulta automaticamente a segunda fonte.
  }

  try {
    const response = await fetch(
      `https://kitana.opencnpj.com/cnpj/${encodeURIComponent(cnpj)}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "ExataERP/1.0",
        },
        signal: AbortSignal.timeout(12000),
        cache: "no-store",
      },
    )

    if (!response.ok) return null

    const result = (await response.json()) as OpenCnpjResponse
    if (!result.success || !result.data) return null

    return {
      fonte: "OpenCNPJ",
      data: {
        cnpj: result.data.cnpj,
        razao_social: result.data.razaoSocial,
        nome_fantasia: result.data.nomeFantasia,
        descricao_situacao_cadastral: result.data.situacaoCadastral,
        logradouro: result.data.logradouro,
        numero: result.data.numero,
        complemento: result.data.complemento,
        bairro: result.data.bairro,
        municipio: result.data.municipio,
        uf: result.data.uf,
        cep: result.data.cep,
        cnae_fiscal_descricao: result.data.cnaes?.[0]?.descricao,
        email: result.data.email,
        ddd_telefone_1: result.data.telefone,
      },
    }
  } catch {
    return null
  }
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

    const consulta = await consultarCnpjPublico(cnpj)
    if (!consulta) {
      return NextResponse.json(
        {
          error:
            "As fontes públicas de CNPJ estão temporariamente indisponíveis. Tente novamente em instantes.",
        },
        { status: 503 },
      )
    }

    const { data, fonte } = consulta
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
      fonte: `Dados públicos do CNPJ via ${fonte}`,
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
