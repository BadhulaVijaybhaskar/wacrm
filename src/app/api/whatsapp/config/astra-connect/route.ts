import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { isAdapterEnvConfigured } from '@/lib/astra-connect'
import { buildSecretRotationUpdate } from '@/lib/astra-connect/secrets'

/**
 * GET /api/whatsapp/config/astra-connect  (admin+)
 * PATCH /api/whatsapp/config/astra-connect (admin+)
 *
 * Per-account Astra Connect adapter switch + optional per-account HMAC
 * secret (encrypted). Global CONNECT_ADAPTER_URL is still required; the
 * secret may be per-account or the global WACRM_ADAPTER_SECRET.
 */

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
      ? row?.astra_connect_secret_previous_expires_at ?? null
      : null,
  }
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const { data, error } = await supabase
      .from('whatsapp_config')
      .select(
        'astra_connect_enabled, astra_connect_tenant_id, astra_employee_id, phone_number_id, astra_connect_secret_encrypted, astra_connect_secret_previous_expires_at',
      )
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      console.error('[astra-connect config GET]', error)
      return NextResponse.json({ error: 'Failed to load config' }, { status: 500 })
    }

    return NextResponse.json({
      env_configured: isAdapterEnvConfigured(),
      enabled: data?.astra_connect_enabled === true,
      tenant_id: data?.astra_connect_tenant_id ?? null,
      employee_id: data?.astra_employee_id ?? null,
      phone_number_id: data?.phone_number_id ?? null,
      has_whatsapp_config: Boolean(data),
      ...secretStatus(data),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'JSON body required' }, { status: 400 })
    }

    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if ('enabled' in body) {
      if (typeof body.enabled !== 'boolean') {
        return NextResponse.json(
          { error: 'enabled must be a boolean' },
          { status: 400 }
        )
      }
      update.astra_connect_enabled = body.enabled
    }

    if ('tenant_id' in body) {
      if (body.tenant_id !== null && typeof body.tenant_id !== 'string') {
        return NextResponse.json(
          { error: 'tenant_id must be a string or null' },
          { status: 400 }
        )
      }
      const tenant =
        typeof body.tenant_id === 'string' ? body.tenant_id.trim() : null
      update.astra_connect_tenant_id = tenant || null
    }

    if ('employee_id' in body) {
      if (body.employee_id !== null && typeof body.employee_id !== 'string') {
        return NextResponse.json(
          { error: 'employee_id must be a string or null' },
          { status: 400 },
        )
      }
      const employee =
        typeof body.employee_id === 'string' ? body.employee_id.trim() : null
      update.astra_employee_id = employee || null
    }

    if ('secret' in body) {
      if (body.secret !== null && typeof body.secret !== 'string') {
        return NextResponse.json(
          { error: 'secret must be a string or null' },
          { status: 400 },
        )
      }
      if (typeof body.secret === 'string' && body.secret.trim().length < 16) {
        return NextResponse.json(
          { error: 'secret must be at least 16 characters' },
          { status: 400 },
        )
      }

      const { data: existingSecretRow, error: existingErr } = await supabase
        .from('whatsapp_config')
        .select(
          'astra_connect_secret_encrypted, astra_connect_secret_previous_encrypted, astra_connect_secret_previous_expires_at',
        )
        .eq('account_id', accountId)
        .maybeSingle()
      if (existingErr) {
        console.error('[astra-connect config PATCH secret load]', existingErr)
        return NextResponse.json(
          { error: 'Failed to update config' },
          { status: 500 },
        )
      }

      Object.assign(
        update,
        buildSecretRotationUpdate(
          typeof body.secret === 'string' ? body.secret : null,
          {
            currentEncrypted:
              existingSecretRow?.astra_connect_secret_encrypted ?? null,
            previousEncrypted:
              existingSecretRow?.astra_connect_secret_previous_encrypted ?? null,
            previousExpiresAt:
              existingSecretRow?.astra_connect_secret_previous_expires_at ?? null,
          },
        ),
      )
    }

    if (Object.keys(update).length === 1) {
      return NextResponse.json(
        { error: 'Provide enabled, tenant_id, employee_id, and/or secret' },
        { status: 400 }
      )
    }

    // Enabling without a tenant id is useless — reject early.
    if (update.astra_connect_enabled === true) {
      const { data: current } = await supabase
        .from('whatsapp_config')
        .select('astra_connect_tenant_id')
        .eq('account_id', accountId)
        .maybeSingle()
      const tenant =
        (update.astra_connect_tenant_id as string | null | undefined) ??
        current?.astra_connect_tenant_id
      if (!tenant) {
        return NextResponse.json(
          {
            error:
              'astra_connect_tenant_id is required when enabling the adapter',
          },
          { status: 400 }
        )
      }
    }

    const { data, error } = await supabase
      .from('whatsapp_config')
      .update(update)
      .eq('account_id', accountId)
      .select(
        'astra_connect_enabled, astra_connect_tenant_id, astra_employee_id, phone_number_id, astra_connect_secret_encrypted, astra_connect_secret_previous_expires_at',
      )
      .maybeSingle()

    if (error) {
      console.error('[astra-connect config PATCH]', error)
      return NextResponse.json({ error: 'Failed to update config' }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json(
        { error: 'WhatsApp is not configured for this account' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      env_configured: isAdapterEnvConfigured(),
      enabled: data.astra_connect_enabled === true,
      tenant_id: data.astra_connect_tenant_id ?? null,
      employee_id: data.astra_employee_id ?? null,
      phone_number_id: data.phone_number_id ?? null,
      ...secretStatus(data),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
