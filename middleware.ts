import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_ROUTES = ['/login', '/primeiro-acesso', '/recuperar-senha']

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
        setAll(cookiesToSet) {
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

  // Não usar getSession() no middleware — usar getUser() por segurança
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isPublicRoute = PUBLIC_ROUTES.some((r) => pathname.startsWith(r))

  // Usuário não autenticado tentando acessar rota protegida
  if (!user && !isPublicRoute) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/login'
    if (pathname !== '/') {
      redirectUrl.searchParams.set('redirect', pathname)
    }
    return NextResponse.redirect(redirectUrl)
  }

  // Usuário autenticado tentando acessar /login → manda pro app
  if (user && pathname === '/login') {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/'
    redirectUrl.searchParams.delete('redirect')
    return NextResponse.redirect(redirectUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
