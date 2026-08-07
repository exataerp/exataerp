import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import {
  REQUIRED_PASSWORD_CHANGE_PATH,
  isPublicAuthApiPath,
} from '@/lib/password-access'

const PUBLIC_PAGE_ROUTES = new Set([
  '/login',
  '/primeiro-acesso',
  '/recuperar-senha',
])

const ROTAS_RESTRITAS: Record<string, string[]> = {
  '/acessar-empresa': ['system_manager'],
  '/setup':         ['system_manager'],
  '/configuracoes': ['system_manager', 'production_user'],
  '/usuarios':      ['system_manager'],
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Esta rota recebe e valida explicitamente o Bearer token. Deixá-la passar
  // aqui evita que uma sessão em renovação seja convertida em redirect HTML
  // antes que o endpoint possa sincronizar o intervalo programado.
  if (
    pathname === '/api/apontamentos/sincronizar-intervalo'
    || pathname.startsWith('/api/auditoria')
  ) {
    return NextResponse.next()
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const isPublicPage = PUBLIC_PAGE_ROUTES.has(pathname)

  if (pathname === REQUIRED_PASSWORD_CHANGE_PATH && !user) {
    return NextResponse.redirect(new URL('/login', request.url), 307)
  }

  // Auth APIs own their JSON contract for both authenticated and anonymous
  // callers. Redirecting them here would turn fetch responses into HTML.
  if (isPublicAuthApiPath(pathname)) return supabaseResponse

  if (isPublicPage) {
    if (user) {
      if (pathname !== REQUIRED_PASSWORD_CHANGE_PATH) {
        return NextResponse.redirect(new URL('/', request.url))
      }
    }
    return supabaseResponse
  }

  if (!user) {
    const url = new URL('/login', request.url)
    url.searchParams.set('redirect', pathname)
    return NextResponse.redirect(url)
  }

  const rotaRestrita = Object.entries(ROTAS_RESTRITAS).find(
    ([rota]) => pathname.startsWith(rota)
  )

  if (rotaRestrita) {
    const [, rolesPermitidos] = rotaRestrita

    const { data: perfil, error: perfilError } = await supabase
      .from('perfis')
      .select('empresa_id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (perfilError) {
      return NextResponse.json(
        { error: 'Não foi possível validar o acesso.' },
        { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
      )
    }
    if (!perfil?.empresa_id) {
      return NextResponse.redirect(new URL('/', request.url))
    }

    const { data: rolesData, error: rolesError } = await supabase
      .from('v_user_roles')
      .select('role_name')
      .eq('user_id', user.id)
      .eq('empresa_id', perfil.empresa_id)

    if (rolesError) {
      return NextResponse.json(
        { error: 'Não foi possível validar o acesso.' },
        { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
      )
    }
    const userRoles = (rolesData ?? []).map((r: any) => r.role_name)
    const temAcesso = rolesPermitidos.some(role => userRoles.includes(role))

    if (!temAcesso) {
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
