"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  AlertCircle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Database,
  Loader2,
  ShieldCheck,
} from "lucide-react"

import { useAuth } from "@/contexts/AuthContext"
import { cnpjValido, formatarCnpj } from "@/lib/cnpj"
import { createClient } from "@/lib/supabase/client"

export default function AcessarEmpresaPage() {
  const router = useRouter()
  const { session, loading: authLoading, supabaseUser, reloadSession } = useAuth()
  const [cnpj, setCnpj] = useState("")
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [empresaEncontrada, setEmpresaEncontrada] = useState<string | null>(null)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setErro(null)

    if (!cnpjValido(cnpj)) {
      setErro("Confira o CNPJ informado. Ele deve possuir 14 posições e dígitos verificadores válidos.")
      return
    }

    setLoading(true)
    try {
      const supabase = createClient()
      const { data: { session: authSession } } = await supabase.auth.getSession()
      const token = authSession?.access_token

      if (!token) {
        throw new Error("Sua sessão expirou. Entre novamente para continuar.")
      }

      const response = await fetch("/api/empresa/consultar-cnpj", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ cnpj }),
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error ?? "Não foi possível consultar o CNPJ.")
      }

      setEmpresaEncontrada(payload.empresa.nome)
      await reloadSession()
      window.setTimeout(() => {
        router.replace("/?tab=configuracoes&empresa=atualizada")
      }, 900)
    } catch (error: any) {
      setErro(error?.message ?? "Erro de conexão. Tente novamente.")
      setLoading(false)
    }
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="h-6 w-6 text-primary animate-spin" />
      </div>
    )
  }

  if (!session || !supabaseUser) {
    return null
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950 flex items-center justify-center px-4 py-8 sm:py-10 relative overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at 25% 15%, hsl(212 100% 54% / 0.10) 0%, transparent 52%), radial-gradient(ellipse at 80% 85%, hsl(199 92% 68% / 0.08) 0%, transparent 48%)",
        }}
      />

      <main className="relative w-full max-w-[500px] space-y-6">
        <div className="flex items-center justify-between px-1">
          <div>
            <p className="text-sm font-black tracking-tight text-slate-950 uppercase">EXATA</p>
            <p className="text-[10px] font-bold text-blue-600">Gestão industrial</p>
          </div>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="text-[11px] font-semibold text-slate-500 hover:text-slate-900 transition-colors"
          >
            Voltar ao sistema
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl shadow-2xl shadow-slate-200/70 overflow-hidden">
          <div className="h-px bg-gradient-to-r from-transparent via-blue-200 to-transparent" />
          <div className="p-7 sm:p-10 space-y-7">
            <div className="space-y-4">
              <div className="h-12 w-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Building2 className="h-6 w-6 text-primary" />
              </div>
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-primary">
                  Identificação da empresa
                </p>
                <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-950">
                  Acesse sua empresa
                </h1>
                <p className="text-sm leading-relaxed text-slate-500">
                  Informe o CNPJ para localizar e preencher automaticamente os dados cadastrais da sua fábrica.
                </p>
              </div>
            </div>

            {erro && (
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <p className="text-xs font-medium leading-relaxed">{erro}</p>
              </div>
            )}

            {empresaEncontrada && (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-green-50 border border-green-200 text-green-700 animate-in fade-in zoom-in-95 duration-200">
                <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-bold">Empresa localizada</p>
                  <p className="text-xs text-green-600 mt-0.5">{empresaEncontrada}</p>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <label
                  htmlFor="cnpj"
                  className="block text-[11px] font-bold text-slate-600 uppercase tracking-widest"
                >
                  CNPJ
                </label>
                <div className="relative">
                  <input
                    id="cnpj"
                    value={cnpj}
                    onChange={(event) => setCnpj(formatarCnpj(event.target.value))}
                    placeholder="00.000.000/0000-00"
                    maxLength={18}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    disabled={loading || Boolean(empresaEncontrada)}
                    className="w-full h-14 pl-12 pr-4 rounded-xl border border-slate-300 bg-slate-50/70 text-slate-950 text-lg font-semibold tracking-wide placeholder:text-slate-400 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all disabled:opacity-60"
                  />
                  <Database className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                </div>
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Compatível com CNPJ numérico e com o novo formato alfanumérico.
                </p>
              </div>

              <button
                type="submit"
                disabled={loading || Boolean(empresaEncontrada)}
                className="w-full h-12 rounded-xl bg-primary text-primary-foreground text-sm font-bold uppercase tracking-widest flex items-center justify-center gap-2.5 shadow-lg shadow-primary/20 hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading || empresaEncontrada ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {empresaEncontrada ? "Abrindo configurações..." : "Consultando dados..."}
                  </>
                ) : (
                  <>
                    Acessar minha empresa
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>

            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 p-4 rounded-2xl border border-slate-200 bg-slate-50">
              <ShieldCheck className="h-5 w-5 text-primary row-span-2" />
              <p className="text-[11px] font-bold text-slate-800">Consulta segura no servidor</p>
              <p className="text-[10px] text-slate-500 leading-relaxed">
                Nome, endereço e atividade principal serão preenchidos. Funcionários e tempo operacional permanecem manuais.
              </p>
            </div>
          </div>
        </div>

        <p className="text-center text-[10px] text-slate-400">
          Dados cadastrais públicos de CNPJ • Exata ERP © 2026
        </p>
      </main>
    </div>
  )
}
