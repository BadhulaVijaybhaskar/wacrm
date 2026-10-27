import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  loadAstraConnectAccountConfig: vi.fn(),
  isAstraConnectActive: vi.fn(),
  postSignedJson: vi.fn(),
}))

vi.mock('./config', () => ({
  loadAstraConnectAccountConfig: h.loadAstraConnectAccountConfig,
  isAstraConnectActive: h.isAstraConnectActive,
}))
vi.mock('./client', () => ({
  postSignedJson: h.postSignedJson,
}))

import { notifyConnectOutbound } from './notify'
import { notifyConnectHandoff } from './handoff'

describe('notifyConnectOutbound (/message)', () => {
  beforeEach(() => {
    h.loadAstraConnectAccountConfig.mockResolvedValue({
      enabled: true,
      tenantId: 't_abc',
      phoneNumberId: '106540352242922',
      whatsappNumber: null,
    })
    h.isAstraConnectActive.mockReturnValue(true)
    h.postSignedJson.mockReset().mockResolvedValue({
      ok: true,
      status: 200,
      data: { conversation_id: 'conv_1', stored: true, handoff: false },
    })
  })

  it('POSTs human author payload to /message', async () => {
    await notifyConnectOutbound({
      db: {} as never,
      accountId: 'acct-1',
      customerPhone: '+919812345678',
      messageId: 'wamid.OUT1',
      author: 'human',
      text: 'Thanks, we will call you.',
      sentBy: 'agent@acme.com',
      timestamp: '2026-10-27T15:10:00Z',
    })

    expect(h.postSignedJson).toHaveBeenCalledTimes(1)
    const call = h.postSignedJson.mock.calls[0][0]
    expect(call.path).toBe('/api/channels/whatsapp/message')
    expect(JSON.parse(call.rawBody)).toMatchObject({
      tenant_id: 't_abc',
      phone_number_id: '106540352242922',
      customer_phone: '+919812345678',
      message_id: 'wamid.OUT1',
      author: 'human',
      text: 'Thanks, we will call you.',
      sent_by: 'agent@acme.com',
    })
  })

  it('POSTs template author with template_name', async () => {
    await notifyConnectOutbound({
      db: {} as never,
      accountId: 'acct-1',
      customerPhone: '919812345678',
      messageId: 'wamid.OUT2',
      author: 'template',
      text: 'Hi Priya, reminder…',
      templateName: 'visit_reminder',
    })

    const body = JSON.parse(h.postSignedJson.mock.calls[0][0].rawBody)
    expect(body.author).toBe('template')
    expect(body.template_name).toBe('visit_reminder')
    expect(body.customer_phone).toBe('+919812345678')
  })
})

describe('notifyConnectHandoff', () => {
  beforeEach(() => {
    h.loadAstraConnectAccountConfig.mockResolvedValue({
      enabled: true,
      tenantId: 't_abc',
      phoneNumberId: '106540352242922',
      whatsappNumber: null,
    })
    h.isAstraConnectActive.mockReturnValue(true)
    h.postSignedJson.mockReset().mockResolvedValue({
      ok: true,
      status: 200,
      data: { conversation_id: 'conv_1', handoff: false },
    })
  })

  it('POSTs handoff:false with conversation_id when releasing', async () => {
    await notifyConnectHandoff({
      db: {} as never,
      accountId: 'acct-1',
      handoff: false,
      astraConversationId: 'conv_1',
      by: 'agent@acme.com',
      reason: 'agent_closed',
    })

    const call = h.postSignedJson.mock.calls[0][0]
    expect(call.path).toBe('/api/channels/whatsapp/handoff')
    expect(JSON.parse(call.rawBody)).toMatchObject({
      tenant_id: 't_abc',
      conversation_id: 'conv_1',
      handoff: false,
      by: 'agent@acme.com',
      reason: 'agent_closed',
    })
  })

  it('falls back to phone_number_id + customer_phone', async () => {
    await notifyConnectHandoff({
      db: {} as never,
      accountId: 'acct-1',
      handoff: true,
      customerPhone: '919812345678',
      reason: 'agent_takeover',
    })

    expect(JSON.parse(h.postSignedJson.mock.calls[0][0].rawBody)).toMatchObject({
      phone_number_id: '106540352242922',
      customer_phone: '+919812345678',
      handoff: true,
    })
  })
})
