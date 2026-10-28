import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { isAdapterEnvConfigured } from '@/lib/astra-connect'
import { buildSecretRotationUpdate } from '@/lib/astra-connect/secrets'

/**
 * POST /api/whatsapp/config/astra-connect/secret
 *
 * Generate or rotate the per-account Connect HMAC secret. Returns the
 * plaintext **once** in the response body — it is never readable again
 * from GET (only has_secret / rotation flags).
 *
 * Body: `{ "action": "generate" | "rotate" }`
 *   - generate: fails if a secret already exists (use rotate)
 *   - rotate: always mints a new secret; previous stays valid 24h
 */

function mintSecret(): string {
  return randomBytes(32).toString('base64url')
}

function secretStatus(row: {
  astra_connect_secret_encrypted?: string | null
  astra_connect_secret_previous_expires_at?: string | null
} | null) {
  const hasSecret = Boolean(row?.astra_connect_secret_encrypted)
  const prevExp = row?.astra_connect_secret_previous_expires_at
    ? Date.parse(row.astra_connect_secret_previous_expires_at)
    : NaN
  const rotationActive =
    hasSecret && Number.isFinite(prevExp) && prevExp > Date.now()
  return {
    has_secret: hasSecret,
    rotation_active: rotationActive,
    previous_expires_at: rotationActive
      ? (row?.astra_connect_secret_previous_expires_at ?? null)
      : null,
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    const action =
      body && typeof body === 'object' && typeof body.action === 'string'
        ? body.action
        : null
    if (action !== 'generate' && action !== 'rotate') {
      return NextResponse.json(
        { error: 'action must be "generate" or "rotate"' },
        { status: 400 },
      )
    }

    const { data: existing, error: loadErr } = await supabase
      .from('whatsapp_config')
      .select(
        'astra_connect_secret_encrypted, astra_connect_secret_previous_encrypted, astra_connect_secret_previous_expires_at',
      )
      .eq('account_id', accountId)
      .maybeSingle()

    if (loadErr) {
      console.error('[astra-connect secret] load', loadErr)
      return NextResponse.json({ error: 'Failed to load config' }, { status: 500 })
    }
    if (!existing) {
      return NextResponse.json(
        { error: 'WhatsApp is not configured for this account' },
        { status: 404 },
      )
    }

    if (action === 'generate' && existing.astra_connect_secret_encrypted) {
      return NextResponse.json(
        { error: 'Secret already exists — use rotate' },
        { status: 409 },
      )
    }

    const plaintext = mintSecret()
    const update = buildSecretRotationUpdate(plaintext, {
      currentEncrypted: existing.astra_connect_secret_encrypted ?? null,
      previousEncrypted: existing.astra_connect_secret_previous_encrypted ?? null,
      previousExpiresAt: existing.astra_connect_secret_previous_expires_at ?? null,
    })

    const { data, error } = await supabase
      .from('whatsapp_config')
      .update(update)
      .eq('account_id', accountId)
      .select(
        'astra_connect_secret_encrypted, astra_connect_secret_previous_expires_at',
      )
      .maybeSingle()

    if (error || !data) {
      console.error('[astra-connect secret] update', error)
      return NextResponse.json(
        { error: 'Failed to save secret' },
        { status: 500 },
      )
    }

    return NextResponse.json({
      env_configured: isAdapterEnvConfigured(),
      secret: plaintext,
      action,
      ...secretStatus(data),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
