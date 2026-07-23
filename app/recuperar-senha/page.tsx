'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Eye, EyeOff, Loader2, AlertCircle, Check, ShieldCheck } from 'lucide-react'

const REQUISITOS = [
  { id: 'len',     label: 'Mínimo 8 caracteres',           test: (s: string) => s.length >= 8 },
  { id: 'upper',   label: 'Uma letra maiúscula',            test: (s: string) => /[A-Z]/.test(s) },
  { id: 'lower',   label: 'Uma letra minúscula',            test: (s: string) => /[a-z]/.test(s) },
  { id: 'number',  label: 'Um número',                      test: (s: string) => /\d/.test(s) },
  { id: 'special', label: 'Um caractere especial (!@#...)', test: (s: string) => /[^A-Za-z0-9]/.test(s) },
]

function senhaForte(s: string) {
  return REQUISITOS.every(r => r.test(s))
}

type Estado = 'validando' | 'formulario' | 'salvando' | 'sucesso' | 'erro'

function RecuperarSenhaInner() {
  const searchParams = useSearchParams()
  const supabase = createClient()

  const [estado, setEstado] = useState<Estado>('validando')
  const [erroMsg, setErroMsg] = useState('')

  const [novaSenha, setNovaSenha] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [mostrar, setMostrar] = useState(false)
  const [focou, setFocou] = useState(false)
  const [erros, setErros] = useState<Record<string, string>>({})

  // ── Valida token de recuperação ───────────────────────────────────────────
  useEffect(() => {
    const tokenHash = searchParams.get('token_hash')
    const type = searchParams.get('type')

    if (!tokenHash) {
      // Tenta hash fragment (fluxo antigo)
      const hash = window.location.hash
      const params = new URLSearchParams(hash.slice(1))
      const accessTk = params.get('access_token')
      const errDesc = params.get('error_description')

      if (errDesc) {
        setErroMsg(errDesc.includes('expired')
          ? 'Este link de recuperação expirou. Solicite um novo na tela de login.'
          : 'Link inválido. Solicite um novo na tela de login.')
        setEstado('erro')
        return
      }

      if (accessTk) {
        supabase.auth.setSession({ access_token: accessTk, refresh_token: params.get('refresh_token') ?? '' })
          .then(({ error }) => {
            if (error) { setErroMsg('Link inválido.'); setEstado('erro') }
            else setEstado('formulario')
          })
      } else {
        setErroMsg('Link de recuperação não encontrado. Solicite um novo na tela de login.')
        setEstado('erro')
      }
      return
    }

    supabase.auth.verifyOtp({ token_hash: tokenHash, type: (type as any) ?? 'recovery' })
      .then(({ error }) => {
        if (error) {
          setErroMsg(error.message.includes('expired')
            ? 'Este link de recuperação expirou. Solicite um novo na tela de login.'
            : 'Link inválido. Solicite um novo na tela de login.')
          setEstado('erro')
        } else {
          setEstado('formulario')
        }
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const validar = () => {
    const e: Record<string, string> = {}
    if (!senhaForte(novaSenha)) e.senha = 'A senha não atende todos os requisitos.'
    if (novaSenha !== confirmar) e.confirmar = 'As senhas informadas não são iguais.'
    setErros(e)
    return Object.keys(e).length === 0
  }

  const handleRedefinir = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validar()) return
    setEstado('salvando')

    const { error } = await supabase.auth.updateUser({ password: novaSenha })
    if (error) {
      setErroMsg(error.message.includes('same password')
        ? 'Esta senha já foi utilizada anteriormente. Escolha uma nova senha.'
        : error.message)
      setEstado('formulario')
      return
    }

    await supabase.auth.signOut()
    setEstado('sucesso')
    setTimeout(() => { window.location.href = '/login' }, 2000)
  }

  // ─── ESTADOS ──────────────────────────────────────────────────────────────

  if (estado === 'validando') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050608]">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto" />
          <p className="text-xs text-muted-foreground tracking-widest uppercase">Validando link...</p>
        </div>
      </div>
    )
  }

  if (estado === 'sucesso') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[#050608]">
        <div className="w-full max-w-sm text-center space-y-6 bg-white/[0.04] border border-white/10 rounded-3xl p-10 backdrop-blur-xl animate-in zoom-in-95 duration-500">
          <div className="h-16 w-16 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto">
            <ShieldCheck className="h-8 w-8 text-green-400" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-xl font-black text-foreground">Senha redefinida!</h1>
            <p className="text-sm text-muted-foreground">Redirecionando para o login...</p>
          </div>
          <Loader2 className="h-5 w-5 text-primary animate-spin mx-auto" />
        </div>
      </div>
    )
  }

  if (estado === 'erro') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[#050608]">
        <div className="w-full max-w-sm text-center space-y-6 bg-white/[0.04] border border-white/10 rounded-3xl p-10 backdrop-blur-xl">
          <div className="h-14 w-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
            <AlertCircle className="h-7 w-7 text-red-400" />
          </div>
          <div className="space-y-2">
            <h1 className="text-lg font-bold text-foreground">Link inválido</h1>
            <p className="text-sm text-muted-foreground leading-relaxed">{erroMsg}</p>
          </div>
          <a href="/login"
            className="block w-full h-11 flex items-center justify-center rounded-xl bg-primary text-white text-sm font-bold uppercase tracking-widest hover:opacity-90 transition-all">
            Ir para o Login
          </a>
        </div>
      </div>
    )
  }

  // ─── FORMULÁRIO ──────────────────────────────────────────────────────────
  const salvando = estado === 'salvando'

  return (
    <div className="min-h-screen bg-[#050608] flex items-center justify-center px-4 py-16">
      <div className="fixed inset-0 -z-10 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at 30% 20%, hsl(212 100% 54% / 0.10) 0%, transparent 55%)' }} />

      <div className="w-full max-w-md">
        <div className="relative bg-white/[0.04] border border-white/10 rounded-3xl shadow-2xl backdrop-blur-xl overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

          <div className="p-8 sm:p-10 space-y-7">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <span className="text-primary font-black text-[10px]">EX</span>
                </div>
                <span className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest">Recuperar Senha</span>
              </div>
              <h1 className="text-2xl font-black text-foreground tracking-tight">Criar nova senha</h1>
              <p className="text-[12px] text-muted-foreground">Escolha uma senha forte para sua conta.</p>
            </div>

            {erroMsg && estado === 'formulario' && (
              <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-red-500/10 border border-red-500/20">
                <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
                <p className="text-[12px] text-red-400 font-medium">{erroMsg}</p>
              </div>
            )}

            <form onSubmit={handleRedefinir} className="space-y-5" noValidate>

              {/* Nova senha */}
              <div className="space-y-1.5">
                <label htmlFor="nova" className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">Nova senha</label>
                <div className="relative">
                  <input id="nova" type={mostrar ? 'text' : 'password'} value={novaSenha}
                    onChange={e => { setNovaSenha(e.target.value); setErros(p => ({ ...p, senha: '' })) }}
                    onFocus={() => setFocou(true)}
                    placeholder="Mínimo 8 caracteres" disabled={salvando}
                    autoComplete="new-password"
                    className={['w-full h-12 px-4 pr-12 rounded-xl border text-sm bg-white/5 text-foreground placeholder:text-muted-foreground/40 outline-none transition-all duration-200',
                      erros.senha
                        ? 'border-red-500/60 focus:border-red-500 focus:ring-2 focus:ring-red-500/20'
                        : 'border-white/10 focus:border-primary focus:ring-2 focus:ring-primary/20'].join(' ')} />
                  <button type="button" onClick={() => setMostrar(!mostrar)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                    {mostrar ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>

                {/* Indicador requisitos */}
                {(focou || novaSenha.length > 0) && (
                  <div className="grid grid-cols-1 gap-1.5 mt-2 p-3 rounded-xl bg-white/[0.03] border border-white/8">
                    {REQUISITOS.map(r => {
                      const ok = r.test(novaSenha)
                      return (
                        <div key={r.id} className="flex items-center gap-2">
                          <div className={['h-4 w-4 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-300', ok ? 'bg-green-500/20' : 'bg-white/5'].join(' ')}>
                            <Check className={['h-2.5 w-2.5 transition-all duration-300', ok ? 'text-green-400' : 'text-white/15'].join(' ')} />
                          </div>
                          <span className={['text-[11px] transition-colors duration-300', ok ? 'text-green-400' : 'text-muted-foreground/50'].join(' ')}>{r.label}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
                {erros.senha && <p className="flex items-center gap-1.5 text-[11px] text-red-400 font-medium"><AlertCircle className="h-3 w-3" />{erros.senha}</p>}
              </div>

              {/* Confirmar */}
              <div className="space-y-1.5">
                <label htmlFor="confirmar" className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">Confirmar senha</label>
                <input id="confirmar" type="password" value={confirmar}
                  onChange={e => { setConfirmar(e.target.value); setErros(p => ({ ...p, confirmar: '' })) }}
                  placeholder="Repita a senha" disabled={salvando}
                  autoComplete="new-password"
                  className={['w-full h-12 px-4 rounded-xl border text-sm bg-white/5 text-foreground placeholder:text-muted-foreground/40 outline-none transition-all duration-200',
                    erros.confirmar
                      ? 'border-red-500/60 focus:border-red-500 focus:ring-2 focus:ring-red-500/20'
                      : confirmar && novaSenha === confirmar
                        ? 'border-green-500/40 focus:border-green-500 focus:ring-2 focus:ring-green-500/15'
                        : 'border-white/10 focus:border-primary focus:ring-2 focus:ring-primary/20'].join(' ')} />
                {erros.confirmar && <p className="flex items-center gap-1.5 text-[11px] text-red-400 font-medium"><AlertCircle className="h-3 w-3" />{erros.confirmar}</p>}
                {confirmar && novaSenha === confirmar && <p className="flex items-center gap-1.5 text-[11px] text-green-400 font-medium"><Check className="h-3 w-3" />Senhas iguais</p>}
              </div>

              <button type="submit" id="btn-redefinir" disabled={salvando}
                className="w-full h-12 flex items-center justify-center gap-2.5 rounded-xl bg-primary text-white text-sm font-bold uppercase tracking-widest shadow-lg shadow-primary/25 hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50">
                {salvando
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvando...</>
                  : <><ShieldCheck className="h-4 w-4" /> Redefinir senha</>
                }
              </button>
            </form>

            <p className="text-center text-[10px] text-muted-foreground/40">
              <a href="/login" className="text-primary/60 hover:text-primary transition-colors font-semibold">Voltar para o Login</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function RecuperarSenhaPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#050608]">
        <Loader2 className="h-6 w-6 text-primary animate-spin" />
      </div>
    }>
      <RecuperarSenhaInner />
    </Suspense>
  )
}
