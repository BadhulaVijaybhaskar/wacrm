import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  listWabaPhoneNumbers: vi.fn(),
  registerPhoneNumber: vi.fn(),
  verifyPhoneNumber: vi.fn(),
  subscribeWabaToApp: vi.fn(),
}))

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>()
  return {
    ...actual,
    requireRole: mocks.requireRole,
  }
})

vi.mock('@/lib/whatsapp/meta-api', () => ({
  getSubscribedApps: vi.fn(),
  listWabaPhoneNumbers: mocks.listWabaPhoneNumbers,
  registerPhoneNumber: mocks.registerPhoneNumber,
  subscribeWabaToApp: mocks.subscribeWabaToApp,
  verifyPhoneNumber: mocks.verifyPhoneNumber,
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: vi.fn((v: string) => `enc:${v}`),
  decrypt: vi.fn((v: string) => v.replace(/^enc:/, '')),
}))

import { ForbiddenError } from '@/lib/auth/account'
import { DELETE, POST } from './route'

describe('/api/whatsapp/config — admin role gate', () => {
  beforeEach(() => {
    mocks.requireRole.mockReset()
    mocks.listWabaPhoneNumbers.mockReset()
    mocks.registerPhoneNumber.mockReset()
    mocks.verifyPhoneNumber.mockReset()
    mocks.subscribeWabaToApp.mockReset()
  })

  it('refuses a viewer on POST before Meta verify', async () => {
    mocks.requireRole.mockRejectedValue(
      new ForbiddenError("This action requires the 'admin' role or higher"),
    )

    const res = await POST(
      new Request('http://localhost/api/whatsapp/config', {
        method: 'POST',
        body: JSON.stringify({
          access_token: 'tok',
          phone_number_id: '123',
          waba_id: '456',
        }),
      }),
    )

    expect(res.status).toBe(403)
    expect(mocks.listWabaPhoneNumbers).not.toHaveBeenCalled()
    expect(mocks.registerPhoneNumber).not.toHaveBeenCalled()
  })

  it('refuses a viewer on DELETE', async () => {
    mocks.requireRole.mockRejectedValue(
      new ForbiddenError("This action requires the 'admin' role or higher"),
    )

    const res = await DELETE()
    expect(res.status).toBe(403)
  })
})
