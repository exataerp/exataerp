'use client'

import React from 'react'
import { useAuth } from '@/contexts/AuthContext'
import type { RoleName, AbaId } from '@/lib/permissions'

// ------------------------------------------------------------
// ProtectedAction
// Esconde ou exibe elementos de UI com base em role ou aba.
//
// Uso por role:
//   <ProtectedAction role="system_manager">
//     <Button>Excluir</Button>
//   </ProtectedAction>
//
// Uso por aba (verifica se o usuário pode acessar aquela aba):
//   <ProtectedAction aba="relatorios">
//     <Link>Relatórios</Link>
//   </ProtectedAction>
//
// Múltiplos roles (qualquer um dos listados):
//   <ProtectedAction anyRole={['system_manager', 'production_manager']}>
//     <Button>Aprovar OP</Button>
//   </ProtectedAction>
// ------------------------------------------------------------

interface ProtectedActionProps {
  children:  React.ReactNode
  fallback?: React.ReactNode

  // Exige exatamente este role
  role?:     RoleName

  // Exige qualquer um destes roles
  anyRole?:  RoleName[]

  // Exige acesso à aba (verifica pelo mapeamento em lib/permissions.ts)
  aba?:      AbaId
}

export function ProtectedAction({
  children,
  fallback = null,
  role,
  anyRole,
  aba,
}: ProtectedActionProps) {
  const { hasRole, canAccess } = useAuth()

  let temAcesso = true

  if (role) {
    temAcesso = hasRole(role)
  } else if (anyRole && anyRole.length > 0) {
    temAcesso = anyRole.some(r => hasRole(r))
  } else if (aba) {
    temAcesso = canAccess(aba)
  }

  if (!temAcesso) return <>{fallback}</>
  return <>{children}</>
}
