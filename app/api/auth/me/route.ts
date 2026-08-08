import { GET as getSessionProjection } from '../session/route'

export const dynamic = 'force-dynamic'

// Compatibility alias. The canonical projection lives in /api/auth/session.
export async function GET(request: Request) {
  return getSessionProjection(request)
}
