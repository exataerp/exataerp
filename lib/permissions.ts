// ============================================================
// EXATA ERP — lib/permissions.ts
// Source of truth para mapeamento de roles e permissões.
// Usado no AuthContext, middleware, APIs e componentes de UI.
// ============================================================

// ------------------------------------------------------------
// Roles disponíveis no sistema
// Devem corresponder exatamente ao campo `name` da tabela roles
// ------------------------------------------------------------
export const ROLES = {
  SYSTEM_MANAGER:      'system_manager',
  PRODUCTION_MANAGER:  'production_manager',
  PRODUCTION_USER:     'production_user',
  MAINTENANCE_MANAGER: 'maintenance_manager',
  MAINTENANCE_USER:    'maintenance_user',
  STOCK_MANAGER:       'stock_manager',
  STOCK_USER:          'stock_user',
  QUALITY_MANAGER:     'quality_manager',
  VIEWER:              'viewer',
} as const

export type RoleName = typeof ROLES[keyof typeof ROLES]

// ------------------------------------------------------------
// Abas do sistema
// Devem corresponder aos ids usados no NAV_ITEMS do page.tsx
// ------------------------------------------------------------
export const ABAS = {
  DASHBOARD:      'dashboard',
  GBO:            'gbo',
  PCP:            'pcp',
  APONTAMENTO:    'apontamento',
  MAQUINAS:       'maquinas',
  MANUTENCAO:     'manutencao',
  ESTOQUE:        'estoque',
  EXCECOES:       'excecoes',
  RELATORIOS:     'relatorios',
  CONFIGURACOES:  'configuracoes',
  EQUIPE:         'equipe',
} as const

export type AbaId = typeof ABAS[keyof typeof ABAS]

// ------------------------------------------------------------
// Mapeamento: aba → roles que têm acesso
// Para ter acesso, o usuário precisa de AO MENOS UM dos roles listados.
// ------------------------------------------------------------
export const ABA_ROLES: Record<AbaId, RoleName[]> = {
  dashboard: [
    ROLES.SYSTEM_MANAGER,
    ROLES.PRODUCTION_MANAGER,
    ROLES.PRODUCTION_USER,
    ROLES.MAINTENANCE_MANAGER,
    ROLES.MAINTENANCE_USER,
    ROLES.STOCK_MANAGER,
    ROLES.STOCK_USER,
    ROLES.QUALITY_MANAGER,
    ROLES.VIEWER,
  ],
  gbo: [
    ROLES.SYSTEM_MANAGER,
    ROLES.PRODUCTION_MANAGER,
    ROLES.PRODUCTION_USER,
  ],
  pcp: [
    ROLES.SYSTEM_MANAGER,
    ROLES.PRODUCTION_MANAGER,
  ],
  apontamento: [
    ROLES.SYSTEM_MANAGER,
    ROLES.PRODUCTION_MANAGER,
    ROLES.PRODUCTION_USER,
  ],
  maquinas: [
    ROLES.SYSTEM_MANAGER,
    ROLES.PRODUCTION_MANAGER,
    ROLES.MAINTENANCE_MANAGER,
  ],
  manutencao: [
    ROLES.SYSTEM_MANAGER,
    ROLES.MAINTENANCE_MANAGER,
    ROLES.MAINTENANCE_USER,
  ],
  estoque: [
    ROLES.SYSTEM_MANAGER,
    ROLES.STOCK_MANAGER,
    ROLES.STOCK_USER,
  ],
  excecoes: [
    ROLES.SYSTEM_MANAGER,
    ROLES.QUALITY_MANAGER,
    ROLES.PRODUCTION_MANAGER,
  ],
  relatorios: [
    ROLES.SYSTEM_MANAGER,
    ROLES.PRODUCTION_MANAGER,
    ROLES.STOCK_MANAGER,
    ROLES.QUALITY_MANAGER,
  ],
  configuracoes: [
    ROLES.SYSTEM_MANAGER,
  ],
  equipe: [
    ROLES.SYSTEM_MANAGER,
  ],
}

// ------------------------------------------------------------
// Helpers puros (sem dependência de React — usáveis em qualquer lugar)
// ------------------------------------------------------------

/** Retorna true se o usuário tem ao menos um dos roles exigidos pela aba */
export function podeAcessarAba(userRoles: RoleName[], aba: AbaId): boolean {
  const rolesNecessarios = ABA_ROLES[aba]
  if (!rolesNecessarios) return false
  return userRoles.some(r => rolesNecessarios.includes(r))
}

/** Retorna todas as abas que o usuário pode ver */
export function abasVisiveis(userRoles: RoleName[]): AbaId[] {
  return (Object.keys(ABA_ROLES) as AbaId[]).filter(aba =>
    podeAcessarAba(userRoles, aba)
  )
}

/** Retorna true se o usuário tem exatamente este role */
export function hasRole(userRoles: RoleName[], role: RoleName): boolean {
  return userRoles.includes(role)
}

/** Retorna true se o usuário tem TODOS os roles listados */
export function hasAllRoles(userRoles: RoleName[], roles: RoleName[]): boolean {
  return roles.every(r => userRoles.includes(r))
}

/** Retorna true se o usuário é System Manager (admin total) */
export function isSystemManager(userRoles: RoleName[]): boolean {
  return userRoles.includes(ROLES.SYSTEM_MANAGER)
}

// ------------------------------------------------------------
// Labels de exibição para a UI de gerenciamento de equipe
// ------------------------------------------------------------
export const ROLE_LABELS: Record<RoleName, { display: string; description: string }> = {
  system_manager:      { display: 'System Manager',       description: 'Acesso total ao sistema' },
  production_manager:  { display: 'Production Manager',   description: 'Gerencia produção, PCP e relatórios' },
  production_user:     { display: 'Production User',      description: 'Apontamento e visualização do PCP' },
  maintenance_manager: { display: 'Maintenance Manager',  description: 'Gestão completa de manutenção' },
  maintenance_user:    { display: 'Maintenance User',     description: 'Registro de ordens de serviço' },
  stock_manager:       { display: 'Stock Manager',        description: 'Gestão completa de estoque e BOM' },
  stock_user:          { display: 'Stock User',           description: 'Movimentações de estoque' },
  quality_manager:     { display: 'Quality Manager',      description: 'Exceções e relatórios de qualidade' },
  viewer:              { display: 'Viewer',               description: 'Somente leitura' },
}
