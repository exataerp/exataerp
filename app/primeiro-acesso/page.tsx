'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  Eye, EyeOff, Sun, Moon, Check, Loader2, AlertCircle, ShieldCheck
} from 'lucide-react'

// ─── helpers de senha ─────────────────────────────────────────────────────────
const REQUISITOS = [
  { id: 'len',     label: 'Mínimo 8 caracteres',          test: (s: string) => s.length >= 8 },
  { id: 'upper',   label: 'Uma letra maiúscula',           test: (s: string) => /[A-Z]/.test(s) },
  { id: 'lower',   label: 'Uma letra minúscula',           test: (s: string) => /[a-z]/.test(s) },
  { id: 'number',  label: 'Um número',                     test: (s: string) => /\d/.test(s) },
  { id: 'special', label: 'Um caractere especial (!@#...)', test: (s: string) => /[^A-Za-z0-9]/.test(s) },
]

function senhaForte(s: string) {
  return REQUISITOS.every(r => r.test(s))
}

// ─── indicador de requisitos ──────────────────────────────────────────────────
function IndicadorSenha({ senha, show }: { senha: string; show: boolean }) {
  if (!show) return null
  return (
    <div className="grid grid-cols-1 gap-1.5 mt-2 p-3 rounded-xl bg-white/[0.03] border border-white/8">
      {REQUISITOS.map(r => {
        const ok = r.test(senha)
        return (
          <div key={r.id} className="flex items-center gap-2">
            <div className={['h-4 w-4 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-300',
              ok ? 'bg-green-500/20' : 'bg-white/5'].join(' ')}>
              <Check className={['h-2.5 w-2.5 transition-all duration-300',
                ok ? 'text-green-400' : 'text-white/15'].join(' ')} />
            </div>
            <span className={['text-[11px] transition-colors duration-300',
              ok ? 'text-green-400' : 'text-muted-foreground/50'].join(' ')}>
              {r.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── estados das telas ────────────────────────────────────────────────────────
type Estado = 'validando' | 'formulario' | 'concluindo' | 'sucesso' | 'erro_convite' | 'ja_usado'

function PrimeiroAcessoInner() {
  const searchParams = useSearchParams()
  const supabase = createClient()

  const [estado, setEstado] = useState<Estado>('validando')
  const [erroMsg, setErroMsg] = useState('')
  const [tema, setTema] = useState<'dark' | 'light'>('dark')

  // Dados do convite
  const [emailConvite, setEmailConvite] = useState('')
  const [nomeConvite, setNomeConvite] = useState('')

  // Formulário
  const [nome, setNome] = useState('')
  const [senha, setSenha] = useState('')
  const [confirmarSenha, setConfirmarSenha] = useState('')
  const [mostrarSenha, setMostrarSenha] = useState(false)
  const [mostrarConfirmar, setMostrarConfirmar] = useState(false)
  const [aceitouTermos, setAceitouTermos] = useState(false)
  const [focouSenha, setFocouSenha] = useState(false)

  const [erros, setErros] = useState<Record<string, string>>({})
  const [accessToken, setAccessToken] = useState('')

  // ── Valida token do convite ────────────────────────────────────────────────
  useEffect(() => {
    const tokenHash = searchParams.get('token_hash')
    const type = searchParams.get('type')

    if (!tokenHash) {
      // Tenta pegar do hash da URL (fluxo antigo Supabase)
      const hash = window.location.hash
      const params = new URLSearchParams(hash.slice(1))
      const accessTk = params.get('access_token')
      const errDesc = params.get('error_description')

      if (errDesc?.includes('expired')) {
        setEstado('erro_convite')
        setErroMsg('Este convite expirou. Solicite um novo acesso ao administrador da empresa.')
        return
      }

      if (accessTk) {
        setAccessToken(accessTk)
        // Obtém dados do usuário do token
        supabase.auth.getUser(accessTk).then(({ data }) => {
          if (data.user) {
            setEmailConvite(data.user.email ?? '')
            setNomeConvite(data.user.user_metadata?.name ?? '')
            setNome(data.user.user_metadata?.name ?? '')
            if (data.user.user_metadata?.first_access_completed) {
              setEstado('ja_usado')
            } else {
              setEstado('formulario')
            }
          } else {
            setEstado('erro_convite')
            setErroMsg('Link inválido ou expirado.')
          }
        })
      } else {
        setEstado('erro_convite')
        setErroMsg('Link de acesso não encontrado. Verifique o e-mail de convite.')
      }
      return
    }

    // Fluxo PKCE (token_hash na query string)
    supabase.auth.verifyOtp({ token_hash: tokenHash, type: (type as any) ?? 'invite' })
      .then(({ data, error }) => {
        if (error) {
          if (error.message.includes('expired')) {
            setEstado('erro_convite')
            setErroMsg('Este convite expirou. Solicite um novo acesso ao administrador da empresa.')
          } else if (error.message.includes('already')) {
            setEstado('ja_usado')
          } else {
            setEstado('erro_convite')
            setErroMsg('Link inválido. Solicite um novo convite.')
          }
          return
        }
        const user = data.user
        const session = data.session
        if (!user) { setEstado('erro_convite'); return }

        setAccessToken(session?.access_token ?? '')
        setEmailConvite(user.email ?? '')
        setNomeConvite(user.user_metadata?.name ?? '')
        setNome(user.user_metadata?.name ?? '')

        if (user.user_metadata?.first_access_completed) {
          setEstado('ja_usado')
        } else {
          setEstado('formulario')
        }
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Aplica tema ───────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.classList.remove('light', 'dark')
    document.documentElement.classList.add(tema)
  }, [tema])

  // ── Validações ────────────────────────────────────────────────────────────
  const validar = () => {
    const e: Record<string, string> = {}
    if (!nome.trim()) e.nome = 'Informe seu nome completo.'
    if (!senhaForte(senha)) e.senha = 'A senha não atende todos os requisitos.'
    if (senha !== confirmarSenha) e.confirmarSenha = 'As senhas informadas não são iguais.'
    if (!aceitouTermos) e.termos = 'Você precisa aceitar os termos para continuar.'
    setErros(e)
    return Object.keys(e).length === 0
  }

  // ── Concluir primeiro acesso ──────────────────────────────────────────────
  const handleConcluir = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validar()) return
    setEstado('concluindo')

    try {
      // 1. Define senha no Supabase Auth
      const { error: updateErr } = await supabase.auth.updateUser({ password: senha })
      if (updateErr) throw new Error(updateErr.message)

      // 2. Obtém token atualizado
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token ?? accessToken

      // 3. Salva perfil + preferências
      const res = await fetch('/api/auth/primeiro-acesso', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ nome: nome.trim(), tema }),
      })

      if (!res.ok) {
        const { error } = await res.json()
        throw new Error(error ?? 'Erro ao concluir primeiro acesso.')
      }

      const { nivel, onboarding_completed } = await res.json()

      setEstado('sucesso')

      // 4. Redireciona
      setTimeout(() => {
        if (['master', 'admin'].includes(nivel) && !onboarding_completed) {
          window.location.href = '/?setup=true'
        } else {
          window.location.href = '/'
        }
      }, 1800)

    } catch (err: any) {
      setErroMsg(err.message ?? 'Erro inesperado. Tente novamente.')
      setEstado('formulario')
    }
  }

  // ─── RENDERIZAÇÕES POR ESTADO ─────────────────────────────────────────────

  if (estado === 'validando') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050608]">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto" />
          <p className="text-xs text-muted-foreground font-medium tracking-widest uppercase">Validando convite...</p>
        </div>
      </div>
    )
  }

  if (estado === 'ja_usado') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[#050608]">
        <div className="w-full max-w-sm text-center space-y-6 bg-white/[0.04] border border-white/10 rounded-3xl p-10 backdrop-blur-xl">
          <div className="h-14 w-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto">
            <AlertCircle className="h-7 w-7 text-amber-400" />
          </div>
          <div className="space-y-2">
            <h1 className="text-lg font-bold text-foreground">Acesso já concluído</h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Este primeiro acesso já foi concluído. Utilize a tela de Login para entrar.
            </p>
          </div>
          <a href="/login"
            className="block w-full h-11 flex items-center justify-center rounded-xl bg-primary text-white text-sm font-bold uppercase tracking-widest hover:opacity-90 transition-all">
            Ir para o Login
          </a>
        </div>
      </div>
    )
  }

  if (estado === 'erro_convite') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[#050608]">
        <div className="w-full max-w-sm text-center space-y-6 bg-white/[0.04] border border-white/10 rounded-3xl p-10 backdrop-blur-xl">
          <div className="h-14 w-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
            <AlertCircle className="h-7 w-7 text-red-400" />
          </div>
          <div className="space-y-2">
            <h1 className="text-lg font-bold text-foreground">Convite inválido</h1>
            <p className="text-sm text-muted-foreground leading-relaxed">{erroMsg}</p>
          </div>
          <a href="/login"
            className="block w-full h-11 flex items-center justify-center rounded-xl border border-white/10 text-muted-foreground text-sm font-bold uppercase tracking-widest hover:text-foreground hover:bg-white/5 transition-all">
            Ir para o Login
          </a>
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
          <div className="space-y-2">
            <h1 className="text-xl font-black text-foreground">Tudo pronto!</h1>
            <p className="text-sm text-muted-foreground">Sua conta foi ativada com sucesso. Redirecionando...</p>
          </div>
          <Loader2 className="h-5 w-5 text-primary animate-spin mx-auto" />
        </div>
      </div>
    )
  }

  // ─── FORMULÁRIO PRINCIPAL ─────────────────────────────────────────────────
  const concluindo = estado === 'concluindo'

  return (
    <div className="min-h-screen bg-[#050608] flex items-start justify-center px-4 py-10 sm:py-16">
      {/* Fundo */}
      <div className="fixed inset-0 -z-10 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at 25% 15%, hsl(212 100% 54% / 0.10) 0%, transparent 55%), radial-gradient(ellipse at 75% 85%, hsl(199 92% 68% / 0.05) 0%, transparent 45%)' }}
      />

      <div className="w-full max-w-md">

        {/* Toggle de tema (topo direito) */}
        <div className="flex items-center justify-between mb-6">
          <span className="text-[10px] font-black tracking-[0.3em] uppercase text-white/25 select-none">EXATA</span>
          <div className="flex items-center gap-1 p-1 rounded-xl border border-white/10 bg-white/5">
            {(['dark', 'light'] as const).map(t => (
              <button key={t} onClick={() => setTema(t)}
                className={['h-7 px-3 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all',
                  tema === t
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'].join(' ')}>
                {t === 'dark' ? <Moon className="h-3 w-3" /> : <Sun className="h-3 w-3" />}
                {t === 'dark' ? 'Escuro' : 'Claro'}
              </button>
            ))}
          </div>
        </div>

        {/* Card */}
        <div className="relative bg-white/[0.04] border border-white/10 rounded-3xl shadow-2xl backdrop-blur-xl overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

          <div className="p-8 sm:p-10 space-y-7">

            {/* Título */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-primary font-black text-[10px] tracking-tight">EX</span>
                </div>
                <span className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest">Primeiro Acesso</span>
              </div>
              <h1 className="text-2xl font-black text-foreground tracking-tight leading-tight">
                Bem-vindo ao futuro<br />
                <span className="text-primary">da sua gestão</span>
              </h1>
              <p className="text-[12px] text-muted-foreground mt-1">
                {emailConvite
                  ? `Seu acesso foi liberado para ${emailConvite}. Configure sua conta para começar.`
                  : 'Seu acesso foi liberado. Configure sua conta para começar.'}
              </p>
            </div>

            {/* Erro global */}
            {erroMsg && estado === 'formulario' && (
              <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 animate-in slide-in-from-top-2 duration-200">
                <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
                <p className="text-[12px] text-red-400 font-medium">{erroMsg}</p>
              </div>
            )}

            <form onSubmit={handleConcluir} className="space-y-5" noValidate>

              {/* Nome */}
              <div className="space-y-1.5">
                <label htmlFor="nome" className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
                  Nome completo
                </label>
                <input
                  id="nome" type="text" value={nome}
                  onChange={e => { setNome(e.target.value); setErros(p => ({ ...p, nome: '' })) }}
                  placeholder="Seu nome completo"
                  disabled={concluindo}
                  autoComplete="name"
                  className={['w-full h-12 px-4 rounded-xl border text-sm bg-white/5 text-foreground placeholder:text-muted-foreground/40 outline-none transition-all duration-200',
                    erros.nome
                      ? 'border-red-500/60 focus:border-red-500 focus:ring-2 focus:ring-red-500/20'
                      : 'border-white/10 focus:border-primary focus:ring-2 focus:ring-primary/20',
                    concluindo ? 'opacity-50 cursor-not-allowed' : ''].join(' ')}
                />
                {erros.nome && <p className="flex items-center gap-1.5 text-[11px] text-red-400 font-medium"><AlertCircle className="h-3 w-3" />{erros.nome}</p>}
              </div>

              {/* E-mail bloqueado */}
              {emailConvite && (
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">E-mail</label>
                  <div className="w-full h-12 px-4 rounded-xl border border-white/5 bg-white/[0.02] text-muted-foreground text-sm flex items-center select-none">
                    {emailConvite}
                  </div>
                </div>
              )}

              {/* Senha */}
              <div className="space-y-1.5">
                <label htmlFor="nova-senha" className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
                  Senha
                </label>
                <div className="relative">
                  <input
                    id="nova-senha" type={mostrarSenha ? 'text' : 'password'}
                    value={senha}
                    onChange={e => { setSenha(e.target.value); setErros(p => ({ ...p, senha: '' })) }}
                    onFocus={() => setFocouSenha(true)}
                    placeholder="Mínimo 8 caracteres"
                    disabled={concluindo}
                    autoComplete="new-password"
                    className={['w-full h-12 px-4 pr-12 rounded-xl border text-sm bg-white/5 text-foreground placeholder:text-muted-foreground/40 outline-none transition-all duration-200',
                      erros.senha
                        ? 'border-red-500/60 focus:border-red-500 focus:ring-2 focus:ring-red-500/20'
                        : 'border-white/10 focus:border-primary focus:ring-2 focus:ring-primary/20'].join(' ')}
                  />
                  <button type="button" onClick={() => setMostrarSenha(!mostrarSenha)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                    {mostrarSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <IndicadorSenha senha={senha} show={focouSenha || senha.length > 0} />
                {erros.senha && <p className="flex items-center gap-1.5 text-[11px] text-red-400 font-medium"><AlertCircle className="h-3 w-3" />{erros.senha}</p>}
              </div>

              {/* Confirmar senha */}
              <div className="space-y-1.5">
                <label htmlFor="confirmar-senha" className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
                  Confirmar senha
                </label>
                <div className="relative">
                  <input
                    id="confirmar-senha" type={mostrarConfirmar ? 'text' : 'password'}
                    value={confirmarSenha}
                    onChange={e => { setConfirmarSenha(e.target.value); setErros(p => ({ ...p, confirmarSenha: '' })) }}
                    placeholder="Repita a senha"
                    disabled={concluindo}
                    autoComplete="new-password"
                    className={['w-full h-12 px-4 pr-12 rounded-xl border text-sm bg-white/5 text-foreground placeholder:text-muted-foreground/40 outline-none transition-all duration-200',
                      erros.confirmarSenha
                        ? 'border-red-500/60 focus:border-red-500 focus:ring-2 focus:ring-red-500/20'
                        : confirmarSenha && senha === confirmarSenha
                          ? 'border-green-500/40 focus:border-green-500 focus:ring-2 focus:ring-green-500/15'
                          : 'border-white/10 focus:border-primary focus:ring-2 focus:ring-primary/20'].join(' ')}
                  />
                  <button type="button" onClick={() => setMostrarConfirmar(!mostrarConfirmar)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                    {mostrarConfirmar ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {erros.confirmarSenha && <p className="flex items-center gap-1.5 text-[11px] text-red-400 font-medium"><AlertCircle className="h-3 w-3" />{erros.confirmarSenha}</p>}
                {confirmarSenha && senha === confirmarSenha && (
                  <p className="flex items-center gap-1.5 text-[11px] text-green-400 font-medium"><Check className="h-3 w-3" />Senhas iguais</p>
                )}
              </div>

              {/* Aceite de termos */}
              <label className={['flex items-start gap-3 cursor-pointer p-3.5 rounded-xl border transition-all',
                erros.termos ? 'border-red-500/30 bg-red-500/5' : 'border-white/8 hover:border-white/15'].join(' ')}>
                <div
                  onClick={() => { setAceitouTermos(!aceitouTermos); setErros(p => ({ ...p, termos: '' })) }}
                  className={['h-4 w-4 mt-0.5 rounded flex items-center justify-center border flex-shrink-0 transition-all',
                    aceitouTermos ? 'bg-primary border-primary' : 'border-white/20'].join(' ')}>
                  {aceitouTermos && <Check className="h-2.5 w-2.5 text-white" />}
                </div>
                <span className="text-[11px] text-muted-foreground leading-relaxed">
                  Li e aceito os{' '}
                  <span className="text-primary underline underline-offset-2 cursor-pointer hover:text-primary/80 transition-colors">Termos de Uso</span>
                  {' '}e a{' '}
                  <span className="text-primary underline underline-offset-2 cursor-pointer hover:text-primary/80 transition-colors">Política de Privacidade</span>
                </span>
              </label>
              {erros.termos && <p className="flex items-center gap-1.5 text-[11px] text-red-400 font-medium -mt-3"><AlertCircle className="h-3 w-3" />{erros.termos}</p>}

              {/* Botão */}
              <button type="submit"
                id="btn-concluir"
                disabled={concluindo}
                className="w-full h-12 flex items-center justify-center gap-2.5 rounded-xl bg-primary text-white text-sm font-bold uppercase tracking-widest shadow-lg shadow-primary/25 hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                {concluindo
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Concluindo...</>
                  : <><ShieldCheck className="h-4 w-4" /> Concluir primeiro acesso</>
                }
              </button>

            </form>

            <p className="text-center text-[10px] text-muted-foreground/40">
              Já tem uma conta?{' '}
              <a href="/login" className="text-primary/60 hover:text-primary transition-colors font-semibold">
                Ir para o Login
              </a>
            </p>
          </div>
        </div>

        <p className="text-center text-[10px] text-white/10 mt-6 select-none">Exata ERP © 2026</p>
      </div>
    </div>
  )
}

export default function PrimeiroAcessoPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#050608]">
        <Loader2 className="h-6 w-6 text-primary animate-spin" />
      </div>
    }>
      <PrimeiroAcessoInner />
    </Suspense>
  )
}
