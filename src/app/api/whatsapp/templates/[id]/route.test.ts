import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  editMessageTemplate: vi.fn(),
  deleteMessageTemplate: vi.fn(),
}))

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>()
  return {
    ...actual,
    requireRole: mocks.requireRole,
  }
})

vi.mock('@/lib/whatsapp/meta-api', () => ({
  editMessageTemplate: mocks.editMessageTemplate,
  deleteMessageTemplate: mocks.deleteMessageTemplate,
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(() => 'plain-token'),
}))

vi.mock('@/lib/whatsapp/template-validators', () => ({
  validateTemplatePayload: vi.fn(),
}))

vi.mock('@/lib/whatsapp/template-components', () => ({
  buildMetaTemplatePayload: vi.fn(() => ({})),
}))

vi.mock('@/lib/whatsapp/template-header-handle', () => ({
  ensureMediaHeaderHandle: vi.fn(async (p: unknown) => p),
}))

import { ForbiddenError } from '@/lib/auth/account'
import { DELETE, PATCH } from './route'

const TEMPLATE_ID = '11111111-1111-4111-8111-111111111111'

describe('PATCH/DELETE /api/whatsapp/templates/[id] — role gate', () => {
  beforeEach(() => {
    mocks.requireRole.mockReset()
    mocks.editMessageTemplate.mockReset()
    mocks.deleteMessageTemplate.mockReset()
  })

  it('refuses a viewer on PATCH before any Meta call', async () => {
    mocks.requireRole.mockRejectedValue(
      new ForbiddenError("This action requires the 'admin' role or higher"),
    )

    const res = await PATCH(
      new Request(`http://localhost/api/whatsapp/templates/${TEMPLATE_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ category: 'Marketing', body_text: 'hi' }),
      }),
      { params: Promise.resolve({ id: TEMPLATE_ID }) },
    )

    expect(res.status).toBe(403)
    expect(mocks.editMessageTemplate).not.toHaveBeenCalled()
  })

  it('refuses a viewer on DELETE before any Meta call', async () => {
    mocks.requireRole.mockRejectedValue(
      new ForbiddenError("This action requires the 'admin' role or higher"),
    )

    const res = await DELETE(
      new Request(`http://localhost/api/whatsapp/templates/${TEMPLATE_ID}`, {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: TEMPLATE_ID }) },
    )

    expect(res.status).toBe(403)
    expect(mocks.deleteMessageTemplate).not.toHaveBeenCalled()
  })
})
