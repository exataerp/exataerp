import Link from 'next/link'

import { PasswordChangeForm } from '@/components/auth/password-change-form'

export default function AlterarSenhaPage() {
  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground">
      <div className="mx-auto w-full max-w-md">
        <Link href="/" className="text-xs font-semibold text-primary hover:underline">← Voltar ao ERP</Link>
        <section className="mt-5 rounded-2xl border border-border bg-card p-7 shadow-xl sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight">Alterar senha</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Confirme sua senha atual e defina uma nova senha pessoal.
          </p>
          <div className="mt-6">
            <PasswordChangeForm />
          </div>
        </section>
      </div>
    </main>
  )
}
