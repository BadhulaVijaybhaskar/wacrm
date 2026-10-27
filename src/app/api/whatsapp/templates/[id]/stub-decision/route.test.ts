import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  maybeSingle: vi.fn(),
  updateSingle: vi.fn(),
}));

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>();
  return {
    ...actual,
    requireRole: mocks.requireRole,
  };
});

function makeSupabase() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: mocks.maybeSingle,
          }),
        }),
      }),
      update: () => ({
        eq: () => ({
          eq: () => ({
            select: () => ({
              single: mocks.updateSingle,
            }),
          }),
        }),
      }),
    }),
  };
}

import { POST } from './route';

const ID = '11111111-1111-4111-8111-111111111111';

describe('POST /api/whatsapp/templates/[id]/stub-decision', () => {
  beforeEach(() => {
    mocks.requireRole.mockReset();
    mocks.maybeSingle.mockReset();
    mocks.updateSingle.mockReset();
    delete process.env.WHATSAPP_TEMPLATES_DRY_RUN;
    delete process.env.META_STUB;
    mocks.requireRole.mockResolvedValue({
      supabase: makeSupabase(),
      accountId: 'acct-1',
      userId: 'user-1',
    });
  });

  it('refuses when dry-run/stub mode is off', async () => {
    const res = await POST(
      new Request('http://localhost/x', {
        method: 'POST',
        body: JSON.stringify({ decision: 'APPROVED' }),
      }),
      { params: Promise.resolve({ id: ID }) },
    );
    expect(res.status).toBe(403);
  });

  it('approves a PENDING dry-run template under META_STUB', async () => {
    process.env.META_STUB = '1';
    mocks.maybeSingle.mockResolvedValue({
      data: {
        id: ID,
        status: 'PENDING',
        meta_template_id: 'dry-run-abc',
      },
      error: null,
    });
    mocks.updateSingle.mockResolvedValue({
      data: { id: ID, status: 'APPROVED' },
      error: null,
    });

    const res = await POST(
      new Request('http://localhost/x', {
        method: 'POST',
        body: JSON.stringify({ decision: 'APPROVED' }),
      }),
      { params: Promise.resolve({ id: ID }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.stub).toBe(true);
    expect(json.template.status).toBe('APPROVED');
  });

  it('rejects live Meta template ids', async () => {
    process.env.WHATSAPP_TEMPLATES_DRY_RUN = '1';
    mocks.maybeSingle.mockResolvedValue({
      data: { id: ID, status: 'PENDING', meta_template_id: '987654' },
      error: null,
    });

    const res = await POST(
      new Request('http://localhost/x', {
        method: 'POST',
        body: JSON.stringify({ decision: 'REJECTED', reason: 'bad copy' }),
      }),
      { params: Promise.resolve({ id: ID }) },
    );
    expect(res.status).toBe(400);
  });
});
