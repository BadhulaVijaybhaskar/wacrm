import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import {
  EmbeddedSignupError,
  embeddedSignupAppId,
  exchangeEmbeddedSignupCode,
  isEmbeddedSignupEnabled,
  isMetaStubMode,
} from '@/lib/whatsapp/embedded-signup'

/**
 * GET  /api/whatsapp/config/embedded-signup  (admin+)
 * POST /api/whatsapp/config/embedded-signup  (admin+)
 *
 * Scaffolding for WhatsApp Embedded Signup. Feature-flagged by
 * WHATSAPP_EMBEDDED_SIGNUP=1. META_STUB=1 returns fake numeric IDs and
 * never calls Meta.
 */

function featureDisabled() {
  return NextResponse.json(
    { error: 'Embedded Signup is not enabled', enabled: false },
    { status: 404 },
  )
}

export async function GET() {
  try {
    await requireRole('admin')
    const enabled = isEmbeddedSignupEnabled()
    return NextResponse.json({
      enabled,
      stub: isMetaStubMode(),
      app_id: enabled ? embeddedSignupAppId() : null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    if (!isEmbeddedSignupEnabled()) return featureDisabled()

    const { supabase, accountId, userId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'JSON body required' }, { status: 400 })
    }

    const code = typeof body.code === 'string' ? body.code : ''
    const wabaId =
      typeof body.waba_id === 'string' ? body.waba_id : null
    const phoneNumberId =
      typeof body.phone_number_id === 'string' ? body.phone_number_id : null
    const persist = body.persist !== false

    const result = await exchangeEmbeddedSignupCode({
      code,
      wabaId,
      phoneNumberId,
    })

    let saved = false
    if (persist) {
      let encryptedAccessToken: string
      try {
        encryptedAccessToken = encrypt(result.access_token)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'encrypt failed'
        console.error('[embedded-signup] encrypt failed:', message)
        return NextResponse.json(
          {
            error:
              'Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string.',
          },
          { status: 500 },
        )
      }

      const now = new Date().toISOString()
      const baseRow = {
        phone_number_id: result.phone_number_id,
        waba_id: result.waba_id,
        access_token: encryptedAccessToken,
        status: 'connected',
        connected_at: now,
        updated_at: now,
        last_registration_error: null,
      }

      const { data: existing, error: existingErr } = await supabase
        .from('whatsapp_config')
        .select('id')
        .eq('account_id', accountId)
        .maybeSingle()

      if (existingErr) {
        console.error('[embedded-signup] load existing:', existingErr)
        return NextResponse.json(
          { error: 'Failed to load WhatsApp config' },
          { status: 500 },
        )
      }

      if (existing) {
        const { error: updateErr } = await supabase
          .from('whatsapp_config')
          .update(baseRow)
          .eq('account_id', accountId)
        if (updateErr) {
          console.error('[embedded-signup] update:', updateErr)
          return NextResponse.json(
            { error: 'Failed to save WhatsApp config' },
            { status: 500 },
          )
        }
      } else {
        const { error: insertErr } = await supabase
          .from('whatsapp_config')
          .insert({
            account_id: accountId,
            user_id: userId,
            ...baseRow,
          })
        if (insertErr) {
          console.error('[embedded-signup] insert:', insertErr)
          return NextResponse.json(
            { error: 'Failed to save WhatsApp config' },
            { status: 500 },
          )
        }
      }
      saved = true
    }

    return NextResponse.json({
      ok: true,
      stub: result.stub,
      saved,
      waba_id: result.waba_id,
      phone_number_id: result.phone_number_id,
      // Never return the raw access token to the browser — the form
      // shows a masked value after reload. Stub mode still persists it.
    })
  } catch (err) {
    if (err instanceof EmbeddedSignupError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
