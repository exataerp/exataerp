'use client'

import { useState, useEffect, useRef } from 'react'
import { useTheme } from 'next-themes'
import { createClient } from '@/lib/supabase/client'
import {
  Eye, EyeOff, Sun, Moon, ArrowRight, Mail, Lock, Loader2, AlertCircle, X
} from 'lucide-react'

// ─── helpers ─────────────────────────────────────────────────────────────────
function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

// ─── componente de campo ──────────────────────────────────────────────────────
function Field({
  id, label, type = 'text', value, onChange, placeholder, error, disabled,
  suffix, autoComplete,
}: {
  id: string; label: string; type?: string; value: string
  onChange: (v: string) => void; placeholder?: string; error?: string
  disabled?: boolean; suffix?: React.ReactNode; autoComplete?: string
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-widest select-none">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete={autoComplete}
          className={[
            'w-full h-12 px-4 rounded-xl border text-sm bg-white/5 text-foreground placeholder:text-muted-foreground/40',
            'outline-none transition-all duration-200',
            suffix ? 'pr-12' : '',
            error
              ? 'border-red-500/60 focus:border-red-500 focus:ring-2 focus:ring-red-500/20'
              : 'border-white/10 focus:border-primary focus:ring-2 focus:ring-primary/20',
            disabled ? 'opacity-50 cursor-not-allowed' : '',
          ].join(' ')}
        />
        {suffix && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">{suffix}</div>
        )}
      </div>
      {error && (
        <p className="flex items-center gap-1.5 text-[11px] text-red-400 font-medium animate-in slide-in-from-top-1 duration-200">
          <AlertCircle className="h-3 w-3 flex-shrink-0" />
          {error}
        </p>
      )}
    </div>
  )
}

// ─── modal de recuperação de senha ───────────────────────────────────────────
function RecuperarSenhaModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const supabase = createClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValidEmail(email.trim())) return
    setLoading(true)
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://exataerp.vercel.app'
    await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${siteUrl}/recuperar-senha`,
    })
    setSent(true)
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-sm bg-card border border-white/10 rounded-2xl shadow-2xl p-6 space-y-5 animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-300">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-foreground">Recuperar senha</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">Informe seu e-mail cadastrado</p>
          </div>
          <button onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {sent ? (
          <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 text-center space-y-1">
            <p className="text-sm font-semibold text-green-400">E-mail enviado!</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Caso o e-mail esteja cadastrado, você receberá as instruções para redefinir sua senha.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field
              id="recovery-email" label="E-mail" type="email"
              value={email} onChange={setEmail}
              placeholder="seu@email.com" autoComplete="email"
            />
            <button
              type="submit"
              disabled={loading || !isValidEmail(email.trim())}
              className="w-full h-11 flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground text-sm font-bold uppercase tracking-widest transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Enviar instruções'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

// ─── página principal ─────────────────────────────────────────────────────────
export default function LoginPage() {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [mostrarSenha, setMostrarSenha] = useState(false)
  const [lembrar, setLembrar] = useState(false)

  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')
  const [showRecuperar, setShowRecuperar] = useState(false)

  const emailRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()

  useEffect(() => {
    setMounted(true)
    emailRef.current?.focus()
  }, [])

  const emailValido = isValidEmail(email.trim())
  const podeEnviar = emailValido && senha.length > 0 && !loading

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!podeEnviar) return
    setLoading(true)
    setErro('')

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password: senha,
    })

    if (error) {
      // Mensagem genérica — não revela se e-mail existe
      if (
        error.message.toLowerCase().includes('invalid') ||
        error.message.toLowerCase().includes('credentials')
      ) {
        setErro('E-mail ou senha incorretos.')
      } else if (error.message.toLowerCase().includes('email not confirmed')) {
        setErro('Confirme seu e-mail antes de acessar ou utilize o link de primeiro acesso.')
      } else if (error.message.toLowerCase().includes('too many requests')) {
        setErro('Muitas tentativas. Aguarde alguns minutos e tente novamente.')
      } else {
        setErro('Não foi possível realizar o acesso. Verifique sua conexão e tente novamente.')
      }
      setLoading(false)
      return
    }

    // Sucesso — middleware redireciona automaticamente
    window.location.href = '/'
  }

  const isDark = resolvedTheme === 'dark'

  return (
    <>
      {/* Fundo com gradientes */}
      <div className="fixed inset-0 -z-10 bg-[#050608]">
        <div className="absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse at 20% 20%, hsl(212 100% 54% / 0.12) 0%, transparent 50%), radial-gradient(ellipse at 80% 80%, hsl(199 92% 68% / 0.06) 0%, transparent 45%)',
          }}
        />
        {/* Grid sutil */}
        <div className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: 'linear-gradient(hsl(0 0% 100%) 1px, transparent 1px), linear-gradient(90deg, hsl(0 0% 100%) 1px, transparent 1px)',
            backgroundSize: '64px 64px',
          }}
        />
      </div>

      {/* Header: toggle de tema */}
      <header className="fixed top-0 inset-x-0 z-20 flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black tracking-[0.3em] uppercase text-white/30 select-none">EXATA</span>
        </div>
        {mounted && (
          <button
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className="h-9 w-9 flex items-center justify-center rounded-xl border border-white/10 bg-white/5 text-muted-foreground hover:text-foreground hover:bg-white/10 transition-all"
            aria-label="Alternar tema"
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        )}
      </header>

      {/* Conteúdo centralizado */}
      <main className="min-h-screen flex items-center justify-center px-4 py-20">
        <div className="w-full max-w-md">

          {/* Card */}
          <div className="relative bg-white/[0.04] border border-white/10 rounded-3xl shadow-2xl backdrop-blur-xl overflow-hidden">
            {/* Brilho interno no topo */}
            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

            <div className="p-8 sm:p-10 space-y-8">

              {/* Brand */}
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-primary font-black text-sm tracking-tight">EX</span>
                  </div>
                  <div>
                    <h1 className="text-xl font-black text-foreground tracking-tight">Bem-vindo de volta</h1>
                    <p className="text-[11px] text-muted-foreground">Sistema de Gestão Industrial · Exata</p>
                  </div>
                </div>
              </div>

              {/* Formulário */}
              <form onSubmit={handleLogin} className="space-y-5" noValidate>
                <Field
                  id="email"
                  label="E-mail"
                  type="email"
                  value={email}
                  onChange={v => { setEmail(v); setErro('') }}
                  placeholder="seu@email.com"
                  error={email.length > 5 && !emailValido ? 'Informe um e-mail válido.' : undefined}
                  disabled={loading}
                  autoComplete="email"
                  suffix={<Mail className="h-4 w-4 text-muted-foreground/40" />}
                />

                <Field
                  id="senha"
                  label="Senha"
                  type={mostrarSenha ? 'text' : 'password'}
                  value={senha}
                  onChange={v => { setSenha(v); setErro('') }}
                  placeholder="••••••••"
                  disabled={loading}
                  autoComplete="current-password"
                  suffix={
                    <button
                      type="button"
                      onClick={() => setMostrarSenha(!mostrarSenha)}
                      className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                      aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
                    >
                      {mostrarSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  }
                />

                {/* Lembrar + Esqueci */}
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none group">
                    <div
                      onClick={() => setLembrar(!lembrar)}
                      className={[
                        'h-4 w-4 rounded flex items-center justify-center border transition-all flex-shrink-0',
                        lembrar
                          ? 'bg-primary border-primary'
                          : 'border-white/20 group-hover:border-white/40',
                      ].join(' ')}
                    >
                      {lembrar && (
                        <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 10 8" fill="none">
                          <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                    <span className="text-[11px] text-muted-foreground group-hover:text-foreground transition-colors">Lembrar meu acesso</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowRecuperar(true)}
                    className="text-[11px] text-primary hover:text-primary/80 font-semibold transition-colors"
                  >
                    Esqueci minha senha
                  </button>
                </div>

                {/* Erro */}
                {erro && (
                  <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 animate-in slide-in-from-top-2 duration-200">
                    <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
                    <p className="text-[12px] text-red-400 font-medium">{erro}</p>
                  </div>
                )}

                {/* Botão */}
                <button
                  type="submit"
                  id="btn-entrar"
                  disabled={!podeEnviar}
                  className={[
                    'w-full h-12 flex items-center justify-center gap-2.5 rounded-xl text-sm font-bold uppercase tracking-widest transition-all duration-200',
                    podeEnviar
                      ? 'bg-primary text-white shadow-lg shadow-primary/25 hover:opacity-90 active:scale-[0.98]'
                      : 'bg-white/5 text-muted-foreground cursor-not-allowed border border-white/10',
                  ].join(' ')}
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      Entrar
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </form>

              {/* Rodapé */}
              <div className="text-center space-y-2">
                <div className="h-px bg-white/5" />
                <p className="text-[11px] text-muted-foreground/60 pt-1">
                  Ainda não ativou sua conta?{' '}
                  <a href="/primeiro-acesso" className="text-primary/80 hover:text-primary transition-colors font-semibold">
                    Usar link de convite
                  </a>
                </p>
              </div>

            </div>
          </div>

          {/* Rodapé da página */}
          <p className="text-center text-[10px] text-white/15 mt-6 select-none">
            Exata ERP · Sistema de Gestão Industrial © 2026
          </p>
        </div>
      </main>

      {/* Modal recuperar senha */}
      {showRecuperar && <RecuperarSenhaModal onClose={() => setShowRecuperar(false)} />}
    </>
  )
}
