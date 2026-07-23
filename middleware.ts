import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Rotas que não precisam de login
const PUBLIC_ROUTES = ['/login', '/primeiro-acesso', '/recuperar-senha']

// Rotas que exigem tipo_usuario mínimo
// Chave = prefixo da rota | Valor = tipos permitidos
const ROTAS_RESTRITAS: Record<string, string[]> = {
  '/configuracoes': ['admin'],
  '/usuarios':      ['admin'],
  '/relatorios':    ['admin', 'gerente'],
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options as Parameters<typeof supabaseResponse.cookies.set>[2])
          )
        },
      },
    }
  )

  // Obtém usuário autenticado (não usa getSession — mais seguro)
  const { data: { user } } = await supabase.auth.getUser()
  const pathname = request.nextUrl.pathname

  // ── Rotas públicas ──────────────────────────────────────────────────────────
  const isPublic = PUBLIC_ROUTES.some(r => pathname.startsWith(r))

  if (isPublic) {
    // Já logado? Redireciona pro dashboard
    if (user) {
      return NextResponse.redirect(new URL('/', request.url))
    }
    return supabaseResponse
  }

  // ── Sem sessão → login ──────────────────────────────────────────────────────
  if (!user) {
    const url = new URL('/login', request.url)
    url.searchParams.set('redirect', pathname)
    return NextResponse.redirect(url)
  }

  // ── Rotas restritas por tipo_usuario ────────────────────────────────────────
  const rotaRestrita = Object.entries(ROTAS_RESTRITAS).find(
    ([rota]) => pathname.startsWith(rota)
  )

  if (rotaRestrita) {
    const [, tiposPermitidos] = rotaRestrita

    const { data: perfil } = await supabase
      .from('perfis')
      .select('tipo_usuario')
      .eq('user_id', user.id)
      .eq('status', 'ativo')
      .single()

    if (!perfil || !tiposPermitidos.includes(perfil.tipo_usuario)) {
      // Sem permissão → volta pra raiz
      return NextResponse.redirect(new URL('/', request.url))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

