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
          : "Erro inesperado ao carregar as configurações.",
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
    const unidadeTempo = String(body.unidade_tempo ?? "hours")
    const funcionarios = String(body.num_funcionarios ?? "").trim()
    const tempoInformado =
      body.tempo_padrao === null || body.tempo_padrao === ""
        ? null
        : Number(body.tempo_padrao)

    if (!["hours", "minutes", "seconds"].includes(unidadeTempo)) {
      return NextResponse.json({ error: "Unidade de tempo inválida." }, { status: 400 })
    }

    if (tempoInformado !== null && (!Number.isFinite(tempoInformado) || tempoInformado < 0)) {
      return NextResponse.json({ error: "Tempo operacional inválido." }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from("empresas")
      .update({
        num_funcionarios: funcionarios || null,
        tempo_padrao: tempoInformado,
        unidade_tempo: unidadeTempo,
      })
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
