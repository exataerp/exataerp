'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Eye, EyeOff, Lock, Mail, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'

export default function LoginPage() {
  const [email, setEmail]       = useState('')
  const [senha, setSenha]       = useState('')
  const [showSenha, setShowSenha] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [erro, setErro]         = useState<string | null>(null)
  
  // Modal de recuperação
  const [showForgot, setShowForgot] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotSuccess, setForgotSuccess] = useState(false)
  const [forgotErro, setForgotErro] = useState<string | null>(null)

  const supabase = createClient()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro(null)

    if (!email.trim() || !senha) {
      setErro('Por favor, informe o e-mail e a senha.')
      return
    }

    setLoading(true)

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password: senha,
      })

      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          setErro('E-mail ou senha incorretos. Verifique suas credenciais no Supabase Auth.')
        } else {
          setErro(error.message)
        }
        setLoading(false)
        return
      }

      if (data.session) {
        // Redireciona para o dashboard principal
        window.location.href = '/'
      }
    } catch {
      setErro('Erro de conexão com o servidor. Tente novamente.')
      setLoading(false)
    }
  }

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault()
    setForgotErro(null)

    if (!forgotEmail.trim()) {
      setForgotErro('Informe o seu e-mail cadastrado.')
      return
    }

    setForgotLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/recuperar-senha`,
    })

    setForgotLoading(false)
    if (error) {
      setForgotErro(error.message)
    } else {
      setForgotSuccess(true)
    }
  }

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-slate-50 text-slate-900 relative overflow-hidden p-4 select-none">
      {/* Fundo com iluminação sutil */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-100/70 via-slate-50 to-white pointer-events-none" />

      <main className="w-full max-w-[400px] z-10 space-y-6">
        {/* Header / Brand Logo Estilo ERPNext */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-blue-50 border border-blue-200 shadow-lg shadow-blue-100/70 mb-1">
            <span className="text-2xl font-black text-blue-600 tracking-wider">EX</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">Exata ERP</h1>
          <p className="text-xs text-slate-500 font-medium">Solução inteligente para sua gestão</p>
        </div>

        {/* Card Principal */}
        <div className="bg-white border border-slate-200 rounded-2xl p-7 shadow-2xl shadow-slate-200/70 space-y-5">
          <div className="border-b border-slate-200 pb-3">
            <h2 className="text-sm font-semibold text-slate-800">Acessar a Plataforma</h2>
          </div>

          {/* Alert de Erro */}
          {erro && (
            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium animate-in fade-in duration-200">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div className="leading-relaxed">{erro}</div>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            {/* Campo E-mail */}
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-xs font-medium text-slate-700">
                E-mail
              </label>
              <div className="relative">
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="seu.email@empresa.com"
                  disabled={loading}
                  autoComplete="email"
                  className="w-full h-11 px-3.5 pl-10 rounded-xl border border-slate-300 bg-slate-50/70 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 transition-all disabled:opacity-50"
                />
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              </div>
            </div>

            {/* Campo Senha */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="senha" className="block text-xs font-medium text-slate-700">
                  Senha
                </label>
                <button
                  type="button"
                  onClick={() => setShowForgot(true)}
                  className="text-xs text-blue-600 hover:text-blue-700 hover:underline transition-colors"
                >
                  Esqueci minha senha
                </button>
              </div>
              <div className="relative">
                <input
                  id="senha"
                  type={showSenha ? 'text' : 'password'}
                  value={senha}
                  onChange={e => setSenha(e.target.value)}
                  placeholder="••••••••"
                  disabled={loading}
                  autoComplete="current-password"
                  className="w-full h-11 px-3.5 pl-10 pr-10 rounded-xl border border-slate-300 bg-slate-50/70 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 transition-all disabled:opacity-50"
                />
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <button
                  type="button"
                  onClick={() => setShowSenha(!showSenha)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors"
                >
                  {showSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Botão Entrar */}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 mt-2 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold text-sm transition-all shadow-lg shadow-blue-600/25 flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Entrando...</span>
                </>
              ) : (
                <span>Entrar</span>
              )}
            </button>
          </form>
        </div>

        {/* Rodapé institucional ERPNext */}
        <footer className="text-center text-[11px] text-slate-400 space-y-1">
          <p>Exata ERP © 2026. Todos os direitos reservados.</p>
        </footer>
      </main>

      {/* Modal de Esqueci minha senha */}
      {showForgot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/35 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 shadow-2xl shadow-slate-950/15 space-y-4">
            <h3 className="text-base font-bold text-slate-900">Recuperar Senha</h3>
            <p className="text-xs text-slate-500">
              Digite seu e-mail abaixo. Enviaremos um link para você redefinir sua senha.
            </p>

            {forgotSuccess ? (
              <div className="p-4 rounded-xl bg-green-50 border border-green-200 text-green-700 text-xs font-medium flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                <span>E-mail enviado! Verifique sua caixa de entrada.</span>
              </div>
            ) : (
              <form onSubmit={handleForgot} className="space-y-4">
                {forgotErro && (
                  <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
                    {forgotErro}
                  </div>
                )}
                <input
                  type="email"
                  value={forgotEmail}
                  onChange={e => setForgotEmail(e.target.value)}
                  placeholder="seu.email@empresa.com"
                  className="w-full h-11 px-3.5 rounded-xl border border-slate-300 bg-slate-50 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15"
                />
                <div className="flex gap-3 justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => setShowForgot(false)}
                    className="px-4 h-10 text-xs font-semibold text-slate-500 hover:text-slate-900"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={forgotLoading}
                    className="px-5 h-10 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
                  >
                    {forgotLoading ? 'Enviando...' : 'Enviar Link'}
                  </button>
                </div>
              </form>
            )}

            {forgotSuccess && (
              <div className="flex justify-end pt-2">
                <button
                  onClick={() => { setShowForgot(false); setForgotSuccess(false) }}
                  className="px-4 h-9 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                >
                  Fechar
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

