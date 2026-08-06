'use client'

import { useState } from 'react'
import { AlertCircle, Check, CheckCircle2, Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react'

import {
  PASSWORD_REQUIREMENTS,
  type PasswordChangeErrors,
  validatePasswordChange,
} from '@/lib/auth-credentials'
import { createClient } from '@/lib/supabase/client'

type PasswordChangeFormProps = {
  forced?: boolean
}

export function PasswordChangeForm({ forced = false }: PasswordChangeFormProps) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  const [errors, setErrors] = useState<PasswordChangeErrors>({})
  const [apiError, setApiError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return

    const nextErrors = validatePasswordChange(currentPassword, newPassword, confirmation)
    setErrors(nextErrors)
    setApiError(null)
    if (Object.keys(nextErrors).length > 0) return

    setSaving(true)
    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, confirmation }),
      })
      const result = await response.json()

      if (!response.ok) {
        setApiError(result.error ?? 'Não foi possível alterar a senha.')
        return
      }

      setCurrentPassword('')
      setNewPassword('')
      setConfirmation('')
      setSuccess(true)
      window.setTimeout(() => window.location.replace('/login?senha-alterada=1'), 1500)
    } catch {
      setApiError('Erro de conexão. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  async function handleSignOut() {
    setSaving(true)
    const supabase = createClient()
    await supabase.auth.signOut({ scope: 'local' })
    window.location.replace('/login')
  }

  if (success) {
    return (
      <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-5 text-center">
        <CheckCircle2 className="mx-auto h-7 w-7 text-green-700" />
        <p className="mt-2 text-sm font-semibold text-green-800">Senha alterada com sucesso.</p>
        <p className="mt-1 text-xs text-green-700">Entre novamente usando a nova senha.</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {forced && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
          Esta senha foi definida por um administrador. Troque-a antes de acessar o ERP.
        </div>
      )}

      {apiError && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
          <span>{apiError}</span>
        </div>
      )}

      <div>
        <label htmlFor="current-password" className="text-xs font-semibold text-foreground">Senha atual</label>
        <input
          id="current-password"
          type={showPasswords ? 'text' : 'password'}
          value={currentPassword}
          disabled={saving}
          autoComplete="current-password"
          onChange={(event) => {
            setCurrentPassword(event.target.value)
            setErrors((current) => ({ ...current, currentPassword: undefined }))
          }}
          className="mt-1.5 h-11 w-full rounded-xl border border-border bg-input px-3.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
        />
        {errors.currentPassword && <p className="mt-1.5 text-xs text-red-600">{errors.currentPassword}</p>}
      </div>

      <div>
        <label htmlFor="new-password" className="text-xs font-semibold text-foreground">Nova senha</label>
        <div className="relative mt-1.5">
          <input
            id="new-password"
            type={showPasswords ? 'text' : 'password'}
            value={newPassword}
            disabled={saving}
            autoComplete="new-password"
            onChange={(event) => {
              setNewPassword(event.target.value)
              setErrors((current) => ({ ...current, newPassword: undefined }))
            }}
            className="h-11 w-full rounded-xl border border-border bg-input px-3.5 pr-11 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
          />
          <button
            type="button"
            disabled={saving}
            onClick={() => setShowPasswords((current) => !current)}
            aria-label={showPasswords ? 'Ocultar senhas' : 'Mostrar senhas'}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showPasswords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {errors.newPassword && <p className="mt-1.5 text-xs text-red-600">{errors.newPassword}</p>}
      </div>

      <div className="grid grid-cols-1 gap-1.5 rounded-xl border border-border bg-muted/30 p-3 sm:grid-cols-2">
        {PASSWORD_REQUIREMENTS.map((requirement) => {
          const met = requirement.test(newPassword)
          return (
            <div key={requirement.id} className="flex items-center gap-2 text-[11px]">
              <span className={`flex h-4 w-4 items-center justify-center rounded-full ${met ? 'bg-green-100' : 'bg-muted'}`}>
                <Check className={`h-2.5 w-2.5 ${met ? 'text-green-700' : 'text-muted-foreground'}`} />
              </span>
              <span className={met ? 'text-green-700' : 'text-muted-foreground'}>{requirement.label}</span>
            </div>
          )
        })}
      </div>

      <div>
        <label htmlFor="confirm-password" className="text-xs font-semibold text-foreground">Confirmar nova senha</label>
        <input
          id="confirm-password"
          type={showPasswords ? 'text' : 'password'}
          value={confirmation}
          disabled={saving}
          autoComplete="new-password"
          onChange={(event) => {
            setConfirmation(event.target.value)
            setErrors((current) => ({ ...current, confirmation: undefined }))
          }}
          className="mt-1.5 h-11 w-full rounded-xl border border-border bg-input px-3.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
        />
        {errors.confirmation && <p className="mt-1.5 text-xs text-red-600">{errors.confirmation}</p>}
      </div>

      <button
        type="submit"
        disabled={saving}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-xs font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Alterando...</> : <><ShieldCheck className="h-4 w-4" /> Alterar senha</>}
      </button>
      {forced && (
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSignOut()}
          className="h-9 w-full text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-60"
        >
          Sair e usar outra conta
        </button>
      )}
    </form>
  )
}
