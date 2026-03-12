// Backward-compatible alias. Canonical endpoint: /api/v1/health
import { GET as healthGet } from '@/app/api/v1/health/route'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return healthGet(request)
}
