import { NextResponse } from "next/server"

import {
  assertSystemManager,
  AuthError,
  getUserFromToken,
  supabaseAdmin,
} from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

const CAMPOS_CONFIGURACAO =
  "nome, cnpj, endereco, segmento, num_funcionarios, meta_oee, meta_refugo, meta_produtividade, tempo_padrao, unidade_tempo"

async function obterEmpresaDoGestor(request: Request) {
  const user = await getUserFromToken(request)
  const { data: perfil, error } = await supabaseAdmin
    .from("perfis")
    .select("empresa_id")
    .eq("user_id", user.id)
    .single()

  if (error || !perfil?.empresa_id) {
    throw new AuthError("Empresa não encontrada.", 404)
  }

  await assertSystemManager(user.id, perfil.empresa_id)
  return perfil.empresa_id
}

function responderErro(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }

  return NextResponse.json(
    {
      error:
        error instanceof Error
          ? error.message
          : "Erro inesperado ao processar as configurações.",
    },
    { status: 500 },
  )
}

export async function GET(request: Request) {
  try {
    const empresaId = await obterEmpresaDoGestor(request)
    const { data, error } = await supabaseAdmin
      .from("empresas")
      .select(CAMPOS_CONFIGURACAO)
      .eq("id", empresaId)
      .single()

    if (error || !data) {
      throw new Error(`Erro ao carregar a empresa: ${error?.message ?? "registro ausente"}`)
    }

    return NextResponse.json({ empresa: data })
  } catch (error) {
    return responderErro(error)
  }
}

export async function PATCH(request: Request) {
  try {
    const empresaId = await obterEmpresaDoGestor(request)
    const body = await request.json()
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { error: "Formato de configurações inválido." },
        { status: 400 },
      )
    }
    const temCampo = (campo: string) =>
      Object.prototype.hasOwnProperty.call(body, campo)
    const atualizacoes: Record<string, string | number | null> = {}

    if (temCampo("num_funcionarios")) {
      const funcionarios = String(body.num_funcionarios ?? "").trim()
      atualizacoes.num_funcionarios = funcionarios || null
    }

    if (temCampo("unidade_tempo")) {
      const unidadeTempo = String(body.unidade_tempo)
      if (!["hours", "minutes", "seconds"].includes(unidadeTempo)) {
        return NextResponse.json({ error: "Unidade de tempo inválida." }, { status: 400 })
      }
      atualizacoes.unidade_tempo = unidadeTempo
    }

    if (temCampo("tempo_padrao")) {
      const tempoInformado =
        body.tempo_padrao === null || body.tempo_padrao === ""
          ? null
          : Number(body.tempo_padrao)

      if (tempoInformado !== null && (!Number.isFinite(tempoInformado) || tempoInformado < 0)) {
        return NextResponse.json({ error: "Tempo operacional inválido." }, { status: 400 })
      }
      atualizacoes.tempo_padrao = tempoInformado
    }

    for (const campo of ["meta_oee", "meta_refugo", "meta_produtividade"] as const) {
      if (!temCampo(campo)) continue

      const valor = Number(body[campo])
      if (!Number.isFinite(valor) || valor < 0 || valor > 100) {
        return NextResponse.json(
          { error: `A meta ${campo.replace("meta_", "")} deve estar entre 0 e 100%.` },
          { status: 400 },
        )
      }
      atualizacoes[campo] = valor
    }

    if (Object.keys(atualizacoes).length === 0) {
      return NextResponse.json(
        { error: "Nenhuma configuração válida foi informada." },
        { status: 400 },
      )
    }

    const { data, error } = await supabaseAdmin
      .from("empresas")
      .update(atualizacoes)
      .eq("id", empresaId)
      .select(CAMPOS_CONFIGURACAO)
      .single()

    if (error || !data) {
      throw new Error(`Erro ao salvar as configurações: ${error?.message ?? "registro ausente"}`)
    }

    return NextResponse.json({ success: true, empresa: data })
  } catch (error) {
    return responderErro(error)
  }
}
import { NextResponse } from "next/server"

import {
  assertSystemManager,
  AuthError,
  getUserFromToken,
  supabaseAdmin,
} from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

const CAMPOS_CONFIGURACAO =
  "nome, cnpj, endereco, segmento, num_funcionarios, meta_oee, meta_refugo, meta_produtividade, tempo_padrao, unidade_tempo"

async function obterEmpresaDoGestor(request: Request) {
  const user = await getUserFromToken(request)
  const { data: perfil, error } = await supabaseAdmin
    .from("perfis")
    .select("empresa_id")
    .eq("user_id", user.id)
    .single()

  if (error || !perfil?.empresa_id) {
    throw new AuthError("Empresa não encontrada.", 404)
  }

  await assertSystemManager(user.id, perfil.empresa_id)
  return perfil.empresa_id
}

function responderErro(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }

  return NextResponse.json(
    {
      error:
        error instanceof Error
          ? error.message
          : "Erro inesperado ao processar as configurações.",
    },
    { status: 500 },
  )
}

export async function GET(request: Request) {
  try {
    const empresaId = await obterEmpresaDoGestor(request)
    const { data, error } = await supabaseAdmin
      .from("empresas")
      .select(CAMPOS_CONFIGURACAO)
      .eq("id", empresaId)
      .single()

    if (error || !data) {
      throw new Error(`Erro ao carregar a empresa: ${error?.message ?? "registro ausente"}`)
    }

    return NextResponse.json({ empresa: data })
  } catch (error) {
    return responderErro(error)
  }
}

export async function PATCH(request: Request) {
  try {
    const empresaId = await obterEmpresaDoGestor(request)
    const body = await request.json()
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { error: "Formato de configurações inválido." },
        { status: 400 },
      )
    }
    const temCampo = (campo: string) =>
      Object.prototype.hasOwnProperty.call(body, campo)
    const atualizacoes: Record<string, string | number | null> = {}

    if (temCampo("num_funcionarios")) {
      const funcionarios = String(body.num_funcionarios ?? "").trim()
      atualizacoes.num_funcionarios = funcionarios || null
    }

    if (temCampo("unidade_tempo")) {
      const unidadeTempo = String(body.unidade_tempo)
      if (!["hours", "minutes", "seconds"].includes(unidadeTempo)) {
        return NextResponse.json({ error: "Unidade de tempo inválida." }, { status: 400 })
      }
      atualizacoes.unidade_tempo = unidadeTempo
    }

    if (temCampo("tempo_padrao")) {
      const tempoInformado =
        body.tempo_padrao === null || body.tempo_padrao === ""
          ? null
          : Number(body.tempo_padrao)

      if (tempoInformado !== null && (!Number.isFinite(tempoInformado) || tempoInformado < 0)) {
        return NextResponse.json({ error: "Tempo operacional inválido." }, { status: 400 })
      }
      atualizacoes.tempo_padrao = tempoInformado
    }

    for (const campo of ["meta_oee", "meta_refugo", "meta_produtividade"] as const) {
      if (!temCampo(campo)) continue

      const valor = Number(body[campo])
      if (!Number.isFinite(valor) || valor < 0 || valor > 100) {
        return NextResponse.json(
          { error: `A meta ${campo.replace("meta_", "")} deve estar entre 0 e 100%.` },
          { status: 400 },
        )
      }
      atualizacoes[campo] = valor
    }

    if (Object.keys(atualizacoes).length === 0) {
      return NextResponse.json(
        { error: "Nenhuma configuração válida foi informada." },
        { status: 400 },
      )
    }

    const { data, error } = await supabaseAdmin
      .from("empresas")
      .update(atualizacoes)
      .eq("id", empresaId)
      .select(CAMPOS_CONFIGURACAO)
      .single()

    if (error || !data) {
      throw new Error(`Erro ao salvar as configurações: ${error?.message ?? "registro ausente"}`)
    }

    return NextResponse.json({ success: true, empresa: data })
  } catch (error) {
    return responderErro(error)
  }
}
