import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { resumePendingExecution } from '@/lib/automations/engine'
import type { AutomationContext } from '@/lib/automations/engine'

/**
 * Drain due `automation_pending_executions` rows. Meant to be hit
 * on a schedule (Vercel Cron / external pinger) — requires a shared
 * secret via the `x-cron-secret` header to match
 * `AUTOMATION_CRON_SECRET`.
 *
 * The claim step (status = 'running') serves as a simple lock so
 * overlapping invocations don't double-process rows. Best-effort
 * only; expensive SELECT ... FOR UPDATE is avoided in favor of a
 * two-step UPDATE-by-id.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const response = await processPendingExecutions()
  await runHealthCheckIfDue()
  return response
}

const HEALTH_CHECK_BUDGET_MS = 20_000
const HEALTH_CHECK_INTERVAL_MS = 60 * 60 * 1000
let lastHealthCheckAt = 0

/**
 * Best-effort WhatsApp connection health check. Runs after automation
 * processing, at most once per hour per process, and is abandoned after
 * the time budget. It never throws.
 */
async function runHealthCheckIfDue() {
  if (process.env.WACRM_EMBEDDED_SIGNUP !== '1') return
  const now = Date.now()
  if (now - lastHealthCheckAt < HEALTH_CHECK_INTERVAL_MS) return
  lastHealthCheckAt = now

  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve()
    }, HEALTH_CHECK_BUDGET_MS)
  })
  try {
    const { checkScheduledConnections } = await import(
      '@/lib/whatsapp/embedded-signup/health'
    )
    const check = checkScheduledConnections({ signal: controller.signal }).catch(() => {
      console.warn('[embedded-signup] scheduled health check failed')
    })
    await Promise.race([check, timeout])
  } catch {
    console.warn('[embedded-signup] scheduled health check failed')
  } finally {
    clearTimeout(timer)
  }
}

async function processPendingExecutions() {
  const admin = supabaseAdmin()
  const { data: due, error } = await admin
    .from('automation_pending_executions')
    .select('*')
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())
    .order('run_at', { ascending: true })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!due || due.length === 0) return NextResponse.json({ processed: 0 })

  let processed = 0
  for (const row of due) {
    const { data: claim } = await admin
      .from('automation_pending_executions')
      .update({ status: 'running' })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (!claim) continue

    await resumePendingExecution({
      id: row.id as string,
      automation_id: row.automation_id as string,
      // account_id is NOT NULL on automation_pending_executions
      // post-017; the engine uses it for tenant-scoped lookups.
      account_id: row.account_id as string,
      user_id: row.user_id as string,
      contact_id: (row.contact_id as string | null) ?? null,
      log_id: (row.log_id as string | null) ?? null,
      parent_step_id: (row.parent_step_id as string | null) ?? null,
      branch: (row.branch as 'yes' | 'no' | null) ?? null,
      next_step_position: row.next_step_position as number,
      context: (row.context as AutomationContext) ?? {},
    })
    processed++
  }

  return NextResponse.json({ processed })
}
