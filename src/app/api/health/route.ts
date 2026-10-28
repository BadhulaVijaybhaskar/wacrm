import { NextResponse } from 'next/server'

/**
 * Liveness probe — no auth, no tenant data.
 * Returns only `{ status, version }` so staging/nginx health checks
 * can hit this without a session cookie.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function buildVersion(): string {
  // Server-only envs — never NEXT_PUBLIC_* (would force a client bake-in).
  return (
    process.env.GIT_COMMIT?.trim() ||
    process.env.COMMIT_SHA?.trim() ||
    process.env.SOURCE_COMMIT?.trim() ||
    process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    'unknown'
  )
}

export async function GET() {
  return NextResponse.json(
    { status: 'ok', version: buildVersion() },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  )
}
