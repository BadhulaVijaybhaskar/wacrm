import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  loadAstraConnectAccountConfig: vi.fn(),
  isAstraConnectActive: vi.fn(),
  resolveAccountAdapterSecret: vi.fn(() => 'test-adapter-secret-16+'),
  postFn: vi.fn(),
  sendTextFn: vi.fn(),
  buildMediaFn: vi.fn(),
  updates: [] as Record<string, unknown>[],
}))

vi.mock('./config', () => ({
  loadAstraConnectAccountConfig: h.loadAstraConnectAccountConfig,
  isAstraConnectActive: h.isAstraConnectActive,
  resolveAccountAdapterSecret: h.resolveAccountAdapterSecret,
}))

import { dispatchInboundToAstraConnect } from './inbound'

function makeDb() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              assigned_agent_id: null,
              ai_autoreply_disabled: false,
              astra_conversation_id: null,
            },
            error: null,
          }),
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        h.updates.push(payload)
        return {
          eq: async () => ({ error: null }),
        }
      },
    }),
  }
}

const BASE_ARGS = {
  accountId: 'acct-1',
  conversationId: 'local-conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
  messageId: 'wamid.HBgMOTE5ODEy',
  messageTimestamp: new Date().toISOString(),
  text: 'What is the price of the 3 kW kit?',
  customerPhone: '919812345678',
  customerName: 'Priya',
  messageType: 'text',
}

describe('dispatchInboundToAstraConnect', () => {
  beforeEach(() => {
    h.updates.length = 0
    h.loadAstraConnectAccountConfig.mockResolvedValue({
      enabled: true,
      tenantId: 't_abc',
      phoneNumberId: '106540352242922',
      whatsappNumber: null,
    })
    h.isAstraConnectActive.mockReturnValue(true)
    h.postFn.mockReset()
    h.sendTextFn.mockReset().mockResolvedValue({ whatsapp_message_id: 'wamid.OUT' })
    h.buildMediaFn.mockReturnValue([])
  })

  it('POSTs the contract inbound payload shape and sends reply_text', async () => {
    h.postFn.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        reply_text: 'Hi Priya! The 3 kW kit costs 1,80,000.',
        handoff: false,
        conversation_id: 'conv_abc',
      },
    })

    await dispatchInboundToAstraConnect({
      ...BASE_ARGS,
      db: makeDb() as never,
      postFn: h.postFn,
      sendTextFn: h.sendTextFn,
      buildMediaFn: h.buildMediaFn,
    })

    expect(h.postFn).toHaveBeenCalledTimes(1)
    const call = h.postFn.mock.calls[0][0]
    expect(call.path).toBe('/api/channels/whatsapp/inbound')
    const body = JSON.parse(call.rawBody)
    expect(body).toMatchObject({
      tenant_id: 't_abc',
      phone_number_id: '106540352242922',
      customer_phone: '+919812345678',
      customer_name: 'Priya',
      message_id: 'wamid.HBgMOTE5ODEy',
      text: 'What is the price of the 3 kW kit?',
    })
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    expect(h.sendTextFn).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Hi Priya! The 3 kW kit costs 1,80,000.',
        aiGenerated: true,
      })
    )
    expect(h.updates.some((u) => u.astra_conversation_id === 'conv_abc')).toBe(
      true
    )
  })

  it('honours handoff:true — pauses automation and does not send', async () => {
    h.postFn.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        reply_text: null,
        handoff: true,
        conversation_id: 'conv_abc',
      },
    })

    await dispatchInboundToAstraConnect({
      ...BASE_ARGS,
      db: makeDb() as never,
      postFn: h.postFn,
      sendTextFn: h.sendTextFn,
      buildMediaFn: h.buildMediaFn,
    })

    expect(h.sendTextFn).not.toHaveBeenCalled()
    expect(
      h.updates.some((u) => u.ai_autoreply_disabled === true)
    ).toBe(true)
  })

  it('hands to human when Connect still fails after retries', async () => {
    h.postFn.mockResolvedValue({
      ok: false,
      code: 'http_error',
      status: 502,
      message: 'Connect returned 502',
    })

    await dispatchInboundToAstraConnect({
      ...BASE_ARGS,
      db: makeDb() as never,
      postFn: h.postFn,
      sendTextFn: h.sendTextFn,
      buildMediaFn: h.buildMediaFn,
    })

    expect(h.sendTextFn).not.toHaveBeenCalled()
    expect(
      h.updates.some((u) => u.ai_autoreply_disabled === true)
    ).toBe(true)
  })

  it('includes signed media refs in the inbound payload', async () => {
    h.buildMediaFn.mockReturnValue([
      {
        type: 'audio',
        id: 'media_123',
        url: 'https://wa.astraconnect.io/api/astra-connect/media/tok',
        mime_type: 'audio/ogg',
      },
    ])
    h.postFn.mockResolvedValue({
      ok: true,
      status: 200,
      data: { reply_text: null, handoff: false, conversation_id: 'conv_1' },
    })

    await dispatchInboundToAstraConnect({
      ...BASE_ARGS,
      text: null,
      messageType: 'audio',
      mediaId: 'media_123',
      mediaMimeType: 'audio/ogg',
      db: makeDb() as never,
      postFn: h.postFn,
      sendTextFn: h.sendTextFn,
      buildMediaFn: h.buildMediaFn,
    })

    const body = JSON.parse(h.postFn.mock.calls[0][0].rawBody)
    expect(body.media).toEqual([
      {
        type: 'audio',
        id: 'media_123',
        url: 'https://wa.astraconnect.io/api/astra-connect/media/tok',
        mime_type: 'audio/ogg',
      },
    ])
  })

  it('no-ops when adapter is not active', async () => {
    h.isAstraConnectActive.mockReturnValue(false)
    await dispatchInboundToAstraConnect({
      ...BASE_ARGS,
      db: makeDb() as never,
      postFn: h.postFn,
      sendTextFn: h.sendTextFn,
    })
    expect(h.postFn).not.toHaveBeenCalled()
  })
})
