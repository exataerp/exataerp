import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies()
    
    // Cliente Supabase usando a SERVICE ROLE KEY (operações administrativas no servidor)
    const supabaseAdmin = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: () => {},
        },
      }
    )

    // 1. Verifica quem está fazendo a requisição
    const { data: { user: callerUser } } = await supabaseAdmin.auth.getUser()
    if (!callerUser) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const body = await request.json()
    const { email, senha, nome, cargo, tipo_usuario, empresa_id } = body

    if (!email || !senha || !empresa_id) {
      return NextResponse.json({ error: 'Dados obrigatórios faltando (email, senha, empresa_id)' }, { status: 400 })
    }

    // 2. Valida se o usuário que chama a API é realmente 'admin' ou 'gerente' daquela empresa
    const { data: callerPerfil } = await supabaseAdmin
      .from('perfis')
      .select('tipo_usuario')
      .eq('user_id', callerUser.id)
      .eq('empresa_id', empresa_id)
      .eq('status', 'ativo')
      .single()

    if (!callerPerfil || callerPerfil.tipo_usuario !== 'admin') {
      return NextResponse.json({ error: 'Apenas Administradores podem cadastrar novos usuários' }, { status: 403 })
    }

    // 3. Cria a conta no Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password: senha,
      email_confirm: true,
      user_metadata: { nome },
    })

    if (authError || !authData.user) {
      return NextResponse.json({ error: authError?.message || 'Erro ao criar conta no Supabase Auth' }, { status: 400 })
    }

    const newUserId = authData.user.id

    // 4. Insere na tabela `perfis`
    const { data: perfilData, error: perfilError } = await supabaseAdmin
      .from('perfis')
      .insert({
        user_id: newUserId,
        empresa_id,
        nome,
        email: email.trim().toLowerCase(),
        cargo: cargo || null,
        tipo_usuario: tipo_usuario || 'colaborador',
        status: 'ativo',
        first_access_completed: false,
      })
      .select()
      .single()

    if (perfilError) {
      return NextResponse.json({ error: `Usuário auth criado, mas erro ao salvar perfil: ${perfilError.message}` }, { status: 500 })
    }

    return NextResponse.json({ success: true, perfil: perfilData })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erro interno no servidor' }, { status: 500 })
  }
}

