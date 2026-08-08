import { ALL_AUDIT_PERMISSIONS } from './audit.ts'

export function mergeAuditPermissions(
  roles: readonly string[],
  rolePermissions: readonly string[],
  userPermissions: readonly string[],
) {
  return Array.from(new Set([
    ...rolePermissions.filter((permission) => permission.startsWith('auditoria.')),
    ...userPermissions.filter((permission) => permission.startsWith('auditoria.')),
    ...(roles.includes('system_manager') ? ALL_AUDIT_PERMISSIONS : []),
  ]))
}
