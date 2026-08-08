'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, Lock, UserRound } from 'lucide-react'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [senha, setSenha] = useState('')
  const [showSenha, setShowSenha] = useState(false)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('senha-alterada') === '1') {
      setSuccessMessage('Senha alterada. Entre novamente com a nova senha.')
      window.history.replaceState({}, document.title, '/login')
    }
  }, [])

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault()
    setErro(null)

    if (!username.trim() || !senha) {
      setErro('Por favor, informe o nome de usuário e a senha.')
      return
    }

    setLoading(true)
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password: senha,
        }),
      })
      const result = await response.json()

      if (!response.ok) {
        setErro(result.error ?? 'Nome de usuário ou senha incorretos.')
        return
      }

      window.location.assign(result.requires_password_change ? '/primeiro-acesso' : '/')
    } catch {
      setErro('Erro de conexão com o servidor. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      data-public-auth="light"
      className="min-h-screen w-full flex flex-col items-center justify-center bg-slate-50 text-slate-900 relative overflow-hidden p-4 select-none"
      style={{ colorScheme: 'light', backgroundColor: '#f8fafc' }}
    >
      <style>{`
        html:has([data-public-auth="light"]),
        html:has([data-public-auth="light"]) body {
          color-scheme: light !important;
          background: #f8fafc !important;
        }
      `}</style>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-100/70 via-slate-50 to-white pointer-events-none" />

      <main className="w-full max-w-[400px] z-10 space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-blue-50 border border-blue-200 shadow-lg shadow-blue-100/70 mb-1">
            <span className="text-2xl font-black text-blue-600 tracking-wider">EX</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">Exata ERP</h1>
          <p className="text-xs text-slate-500 font-medium">Solução inteligente para sua gestão</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-7 shadow-2xl shadow-slate-200/70 space-y-5">
          <div className="border-b border-slate-200 pb-3">
            <h2 className="text-sm font-semibold text-slate-800">Acessar a Plataforma</h2>
          </div>

          {erro && (
            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium animate-in fade-in duration-200">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div className="leading-relaxed">{erro}</div>
            </div>
          )}

          {successMessage && (
            <div className="flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 p-3.5 text-xs font-medium text-green-700">
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="username" className="block text-xs font-medium text-slate-700">
                Nome de usuário
              </label>
              <div className="relative">
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="seu.usuario"
                  disabled={loading}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="w-full h-11 px-3.5 pl-10 rounded-xl border border-slate-300 bg-slate-50/70 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 transition-all disabled:opacity-50"
                />
                <UserRound className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="senha" className="block text-xs font-medium text-slate-700">
                Senha
              </label>
              <div className="relative">
                <input
                  id="senha"
                  type={showSenha ? 'text' : 'password'}
                  value={senha}
                  onChange={(event) => setSenha(event.target.value)}
                  placeholder="••••••••"
                  disabled={loading}
                  autoComplete="current-password"
                  className="w-full h-11 px-3.5 pl-10 pr-10 rounded-xl border border-slate-300 bg-slate-50/70 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 transition-all disabled:opacity-50"
                />
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <button
                  type="button"
                  onClick={() => setShowSenha((current) => !current)}
                  aria-label={showSenha ? 'Ocultar senha' : 'Mostrar senha'}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors"
                >
                  {showSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 mt-2 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold text-sm transition-all shadow-lg shadow-blue-600/25 flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer"
            >
              {loading ? (
                <><Loader2 className="h-4 w-4 animate-spin" /><span>Entrando...</span></>
              ) : (
                <span>Entrar</span>
              )}
            </button>
          </form>

          <p className="text-center text-[11px] text-slate-500">
            Para redefinir sua senha, fale com o administrador da empresa.
          </p>
        </div>

        <footer className="text-center text-[11px] text-slate-400 space-y-1">
          <p>Exata ERP © 2026. Todos os direitos reservados.</p>
        </footer>
      </main>
    </div>
  )
}
