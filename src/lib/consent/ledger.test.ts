import { describe, expect, it, vi } from 'vitest';
import {
  applyConsentAction,
  isOptedOut,
  processInboundConsentKeyword,
  skipIfOptedOut,
} from './ledger';

function stubDb(opts?: {
  updateError?: { message: string } | null;
  insertError?: { message: string } | null;
}) {
  const updates: unknown[] = [];
  const inserts: unknown[] = [];
  const db = {
    from(table: string) {
      if (table === 'contacts') {
        return {
          update(payload: unknown) {
            updates.push(payload);
            return {
              eq() {
                return {
                  eq: async () => ({ error: opts?.updateError ?? null }),
                };
              },
            };
          },
        };
      }
      if (table === 'consent_events') {
        return {
          insert: async (payload: unknown) => {
            inserts.push(payload);
            return { error: opts?.insertError ?? null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    _updates: updates,
    _inserts: inserts,
  };
  return db;
}

describe('isOptedOut', () => {
  it('reads the opted_out flag', () => {
    expect(isOptedOut({ id: 'c1', opted_out: true })).toBe(true);
    expect(isOptedOut({ id: 'c1', opted_out: false })).toBe(false);
    expect(isOptedOut(null)).toBe(false);
  });
});

describe('applyConsentAction', () => {
  it('sets opted_out and appends an opt_out event', async () => {
    const db = stubDb();
    const result = await applyConsentAction(db as never, {
      accountId: 'acct',
      contactId: 'c1',
      action: 'opt_out',
      keyword: 'STOP',
    });
    expect(result.optedOut).toBe(true);
    expect(db._updates[0]).toMatchObject({ opted_out: true });
    expect(db._inserts[0]).toMatchObject({
      event_type: 'opt_out',
      keyword: 'STOP',
      source: 'inbound_keyword',
    });
  });

  it('clears opted_out_at on opt_in', async () => {
    const db = stubDb();
    await applyConsentAction(db as never, {
      accountId: 'acct',
      contactId: 'c1',
      action: 'opt_in',
      keyword: 'START',
    });
    expect(db._updates[0]).toMatchObject({
      opted_out: false,
      opted_out_at: null,
    });
    expect(db._inserts[0]).toMatchObject({ event_type: 'opt_in' });
  });
});

describe('processInboundConsentKeyword', () => {
  it('no-ops for ordinary text', async () => {
    const db = stubDb();
    expect(
      await processInboundConsentKeyword(db as never, {
        accountId: 'acct',
        contactId: 'c1',
        text: 'hello there',
      }),
    ).toBeNull();
    expect(db._updates).toHaveLength(0);
  });

  it('applies STOP', async () => {
    const db = stubDb();
    const hit = await processInboundConsentKeyword(db as never, {
      accountId: 'acct',
      contactId: 'c1',
      text: 'STOP',
    });
    expect(hit?.action).toBe('opt_out');
    expect(db._inserts).toHaveLength(1);
  });
});

describe('skipIfOptedOut', () => {
  it('logs send_skipped and returns true when opted out', async () => {
    const db = stubDb();
    const skipped = await skipIfOptedOut(db as never, {
      accountId: 'acct',
      contactId: 'c1',
      optedOut: true,
      source: 'broadcast',
      metadata: { broadcast_id: 'b1' },
    });
    expect(skipped).toBe(true);
    expect(db._inserts[0]).toMatchObject({
      event_type: 'send_skipped',
      source: 'broadcast',
    });
  });

  it('returns false without logging when not opted out', async () => {
    const spy = vi.fn();
    const db = stubDb();
    void spy;
    expect(
      await skipIfOptedOut(db as never, {
        accountId: 'acct',
        contactId: 'c1',
        optedOut: false,
        source: 'automation',
      }),
    ).toBe(false);
    expect(db._inserts).toHaveLength(0);
  });
});
