'use client'

import React from 'react'
import { useAuth, type TipoUsuario } from '@/contexts/AuthContext'

interface ProtectedActionProps {
  /** Nível mínimo necessário para visualizar o elemento ('admin' | 'gerente' | 'colaborador' | 'visualizador') */
  tipoMinimo: TipoUsuario
  /** Elemento a ser renderizado caso possua permissão */
  children: React.ReactNode
  /** Opcional: o que renderizar caso NÃO possua permissão (padrão: null) */
  fallback?: React.ReactNode
}

/**
 * Componente utilitário para proteção de interface no ExataERP.
 * Esconde ou exibe botões/painéis conforme o nível do usuário logado.
 *
 * Exemplo de uso:
 * ```tsx
 * <ProtectedAction tipoMinimo="admin">
 *   <Button variant="destructive">Excluir Máquina</Button>
 * </ProtectedAction>
 * ```
 */
export function ProtectedAction({
  tipoMinimo,
  children,
  fallback = null,
}: ProtectedActionProps) {
  const { podeAcessar } = useAuth()

  if (!podeAcessar(tipoMinimo)) {
    return <>{fallback}</>
  }

  return <>{children}</>
}

