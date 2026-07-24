// ============================================================
// EXATA ERP — hooks/usePermissao.ts
// Hook de conveniência para checar roles e permissões de aba.
// ============================================================
import { useAuth, type RoleName, type AbaId } from '@/contexts/AuthContext'
import { ROLES } from '@/lib/permissions'

export function usePermissao() {
  const { session, hasRole, canAccess, visibleTabs, isSystemManager } = useAuth()
  const roles = session?.roles ?? []

  return {
    // Roles atuais do usuário
    roles,

    // Verificações de role diretas
    isSystemManager,
    isProductionManager:  hasRole(ROLES.PRODUCTION_MANAGER),
    isProductionUser:     hasRole(ROLES.PRODUCTION_USER),
    isMaintenanceManager: hasRole(ROLES.MAINTENANCE_MANAGER),
    isMaintenanceUser:    hasRole(ROLES.MAINTENANCE_USER),
    isStockManager:       hasRole(ROLES.STOCK_MANAGER),
    isStockUser:          hasRole(ROLES.STOCK_USER),
    isQualityManager:     hasRole(ROLES.QUALITY_MANAGER),
    isViewer:             hasRole(ROLES.VIEWER),

    // Verificação genérica por role name
    hasRole,

    // Verificação de acesso por aba
    canAccess,

    // Lista de abas visíveis para o usuário atual
    visibleTabs,

    // Conveniências de ação (o que cada combinação de roles permite fazer)
    podeCriarOrdem:    hasRole(ROLES.PRODUCTION_MANAGER) || hasRole(ROLES.PRODUCTION_USER) || isSystemManager,
    podeApontar:       hasRole(ROLES.PRODUCTION_MANAGER) || hasRole(ROLES.PRODUCTION_USER) || isSystemManager,
    podeGerirProducao: hasRole(ROLES.PRODUCTION_MANAGER) || isSystemManager,
    podeGerirEstoque:  hasRole(ROLES.STOCK_MANAGER) || isSystemManager,
    podeMoverEstoque:  hasRole(ROLES.STOCK_MANAGER) || hasRole(ROLES.STOCK_USER) || isSystemManager,
    podeGerirAtivos:   hasRole(ROLES.MAINTENANCE_MANAGER) || isSystemManager,
    podeGerirQuality:  hasRole(ROLES.QUALITY_MANAGER) || isSystemManager,
    podeVerRelatorios: hasRole(ROLES.PRODUCTION_MANAGER) || hasRole(ROLES.STOCK_MANAGER) || hasRole(ROLES.QUALITY_MANAGER) || isSystemManager,
    podeConfigurar:    isSystemManager,
    podeGerirUsuarios: isSystemManager,
  }
}
