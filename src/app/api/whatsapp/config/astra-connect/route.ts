import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { isAdapterEnvConfigured } from '@/lib/astra-connect'

/**
 * GET /api/whatsapp/config/astra-connect  (admin+)
 * PATCH /api/whatsapp/config/astra-connect (admin+)
 *
 * Per-account Astra Connect adapter switch. The global env
 * (CONNECT_ADAPTER_URL + WACRM_ADAPTER_SECRET) must also be set for
 * the adapter to actually fire; this flag alone is not enough.
 */

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const { data, error } = await supabase
      .from('whatsapp_config')
      .select('astra_connect_enabled, astra_connect_tenant_id, phone_number_id')
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
      phone_number_id: data?.phone_number_id ?? null,
      has_whatsapp_config: Boolean(data),
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

    if (Object.keys(update).length === 1) {
      return NextResponse.json(
        { error: 'Provide enabled and/or tenant_id' },
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
      .select('astra_connect_enabled, astra_connect_tenant_id, phone_number_id')
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
      phone_number_id: data.phone_number_id ?? null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
