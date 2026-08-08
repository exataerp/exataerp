import { PasswordChangeForm } from '@/components/auth/password-change-form'

export default function PrimeiroAcessoPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-950">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-blue-200 bg-blue-50 shadow-lg shadow-blue-100/70">
            <span className="text-xl font-black tracking-wider text-blue-600">EX</span>
          </div>
          <p className="mt-3 text-xs font-semibold text-slate-500">Exata ERP</p>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-7 shadow-2xl shadow-slate-200/70 sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight">Primeiro acesso</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Defina uma senha pessoal antes de continuar. A senha temporária deixará de funcionar após a troca.
          </p>
          <div className="mt-6">
            <PasswordChangeForm forced />
          </div>
        </section>
      </div>
    </main>
  )
}
