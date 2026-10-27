import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPaymentLink } from './links';

describe('createPaymentLink', () => {
  const prevMeta = process.env.META_STUB;

  beforeEach(() => {
    process.env.META_STUB = '1';
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  });

  afterEach(() => {
    if (prevMeta === undefined) delete process.env.META_STUB;
    else process.env.META_STUB = prevMeta;
  });

  it('creates a stub link when provider is connected', async () => {
    const { encrypt } = await import('@/lib/whatsapp/encryption');
    const inserts: unknown[] = [];
    const db = {
      from: (table: string) => {
        if (table === 'integration_connections') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      status: 'connected',
                      credentials_encrypted: encrypt(
                        JSON.stringify({ key_id: 'rzp', key_secret: 'sec' }),
                      ),
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'payment_links') {
          return {
            insert: (row: unknown) => {
              inserts.push(row);
              return {
                select: () => ({
                  single: async () => ({
                    data: {
                      id: 'pl_1',
                      url: (row as { url: string }).url,
                      external_id: (row as { external_id: string }).external_id,
                      provider: 'razorpay',
                    },
                    error: null,
                  }),
                }),
              };
            },
          };
        }
        if (table === 'integration_event_log') {
          return { insert: async () => ({ error: null }) };
        }
        return {};
      },
    };

    const result = await createPaymentLink(db as never, {
      accountId: 'acct',
      userId: 'user',
      conversationId: 'conv',
      provider: 'razorpay',
      amountCents: 50000,
      currency: 'INR',
    });

    expect(result.stub).toBe(true);
    expect(result.url).toContain('razorpay');
    expect(inserts).toHaveLength(1);
  });
});
