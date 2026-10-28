import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const assertForAccount = vi.fn()

vi.mock('@/lib/astra-connect/channel-status', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/astra-connect/channel-status')
  >('@/lib/astra-connect/channel-status')
  return {
    ...actual,
    assertWhatsAppChannelEnabledForAccount: (
      ...args: unknown[]
    ) => assertForAccount(...args),
  }
})

import {
  ChannelGateError,
} from '@/lib/astra-connect/channel-status'
import {
  postCloudApiMessages,
  sendTemplateMessage,
  sendTextMessage,
} from './meta-api'

function okMeta(): Response {
  return new Response(JSON.stringify({ messages: [{ id: 'wamid.OK' }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('postCloudApiMessages — Connect channel gate choke point', () => {
  beforeEach(() => {
    assertForAccount.mockReset()
    assertForAccount.mockResolvedValue({ enabled: true, employee_id: 'e1' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('blocks Meta POST when channel is disabled', async () => {
    assertForAccount.mockRejectedValue(
      new ChannelGateError('channel_disabled', 'off', 'emp_1'),
    )
    const fetchFn = vi.fn(async () => okMeta())

    await expect(
      postCloudApiMessages({
        phoneNumberId: 'pn-1',
        accessToken: 'tok',
        accountId: 'acct-1',
        body: { messaging_product: 'whatsapp', type: 'text' },
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'channel_disabled' })

    expect(fetchFn).not.toHaveBeenCalled()
    expect(assertForAccount).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acct-1', phoneNumberId: 'pn-1' }),
    )
  })

  it('blocks Meta POST when channel status is unavailable', async () => {
    assertForAccount.mockRejectedValue(
      new ChannelGateError('channel_status_unavailable', 'timeout'),
    )
    const fetchFn = vi.fn(async () => okMeta())

    await expect(
      postCloudApiMessages({
        phoneNumberId: 'pn-1',
        accessToken: 'tok',
        accountId: 'acct-1',
        body: { messaging_product: 'whatsapp', type: 'text' },
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'channel_status_unavailable' })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('blocks Meta POST when the number is not linked (404 → channel_not_linked)', async () => {
    assertForAccount.mockRejectedValue(
      new ChannelGateError(
        'channel_not_linked',
        'No Connect employee is linked to this WhatsApp number',
      ),
    )
    const fetchFn = vi.fn(async () => okMeta())

    await expect(
      postCloudApiMessages({
        phoneNumberId: 'pn-1',
        accessToken: 'tok',
        accountId: 'acct-1',
        body: { messaging_product: 'whatsapp', type: 'text' },
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'channel_not_linked' })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('allows Meta POST when channel is enabled', async () => {
    const fetchFn = vi.fn(async () => okMeta())
    const result = await postCloudApiMessages({
      phoneNumberId: 'pn-1',
      accessToken: 'tok',
      accountId: 'acct-1',
      body: { messaging_product: 'whatsapp', type: 'text', text: { body: 'hi' } },
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(result.messageId).toBe('wamid.OK')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('skips the gate when accountId is omitted (standalone/unit tests)', async () => {
    const fetchFn = vi.fn(async () => okMeta())
    await postCloudApiMessages({
      phoneNumberId: 'pn-1',
      accessToken: 'tok',
      body: { messaging_product: 'whatsapp', type: 'text' },
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(assertForAccount).not.toHaveBeenCalled()
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('sendTextMessage / sendTemplateMessage forward accountId into the choke', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okMeta()),
    )
    await sendTextMessage({
      phoneNumberId: 'pn-1',
      accessToken: 'tok',
      to: '15551230000',
      text: 'hi',
      accountId: 'acct-text',
    })
    expect(assertForAccount).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acct-text' }),
    )

    assertForAccount.mockClear()
    await sendTemplateMessage({
      phoneNumberId: 'pn-1',
      accessToken: 'tok',
      to: '15551230000',
      templateName: 'hello',
      accountId: 'acct-tpl',
    })
    expect(assertForAccount).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acct-tpl' }),
    )
  })
})
