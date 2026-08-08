import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

import { MasterTab } from "@/components/master-tab"
import { requireCurrentPrincipal, requireSuperAdmin } from '@/lib/auth-principal'
import { AuthError } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

async function adminAccess(): Promise<'allowed' | 'login' | 'denied'> {
  try {
    const requestHeaders = new Headers(await headers())
    const principal = await requireCurrentPrincipal(new Request('https://internal.exataerp/admin', {
      headers: requestHeaders,
    }))
    requireSuperAdmin(principal)
    return 'allowed'
  } catch (error) {
    return error instanceof AuthError && error.status === 401 ? 'login' : 'denied'
  }
}

export default async function AdminPage() {
  const access = await adminAccess()
  if (access === 'login') redirect('/login?redirect=/admin')
  if (access === 'denied') redirect('/')

  return (
    <div className="min-h-screen bg-background px-4 py-8 lg:px-10">
      <div className="max-w-6xl mx-auto">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-2 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar ao ERP
        </Link>
        <MasterTab />
      </div>
    </div>
  )
}
