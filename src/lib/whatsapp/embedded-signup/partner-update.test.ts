import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handlePartnerUpdate } from './partner-update';

const h = vi.hoisted(() => ({
  rows: [] as Record<string, string>[],
  writes: [] as Record<string, unknown>[],
  filters: [] as [string, unknown][],
  lookupStatuses: [] as string[][],
  updateStatuses: [] as string[][],
  race: false, lookupError: false, writeError: false,
  client: vi.fn(), update: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ createServiceClient: () => {
  h.client();
  return { schema: (schema: string) => {
    expect(schema).toBe('wacrm');
    return { from: (table: string) => {
      expect(table).toBe('wa_connections');
      return {
        select: () => ({ in: (key: string, values: string[]) => {
          expect(key).toBe('status');
          h.lookupStatuses.push(values);
          return { eq: async (key: string, value: unknown) => ({
            data: h.rows.filter(row => row[key] === value && values.includes(row.status)).map(row => ({ ...row })),
            error: h.lookupError ? {} : null,
          }) };
        } }),
        update: (patch: Record<string, unknown>) => {
          h.update(patch);
          const filters: [string, unknown][] = [];
          let statuses: string[] = [];
          const q = {
            in: (key: string, values: string[]) => {
              expect(key).toBe('status');
              statuses = values; h.updateStatuses.push(values); return q;
            },
            eq: (key: string, value: unknown) => { filters.push([key, value]); return q; },
            lt: async (key: string, value: string) => {
              expect(key).toBe('updated_at');
              expect(value).toBe(new Date(time * 1000).toISOString());
              h.filters = filters;
              if (h.race) h.rows[0].status = 'disconnected';
              for (const row of h.rows) {
                if (statuses.includes(row.status) && filters.every(([k, v]) => row[k] === v) &&
                    Date.parse(row[key]) < Date.parse(value) && !h.writeError) {
                  h.writes.push(patch);
                  Object.assign(row, patch, { updated_at: new Date(Date.parse(value) + 5000).toISOString() });
                }
              }
              return { error: h.writeError ? {} : null };
            },
          };
          return q;
        },
      };
    } };
  } };
} }));
const time = Date.parse('2026-10-30T10:00:00Z') / 1000;
const event = (event: string) => ({ event, waba_info: { waba_id: 'waba', owner_business_id: 'business' } });
const removedPatch = { status: 'disconnected', last_error: 'WhatsApp: Partner access removed. Reconnect WhatsApp.' };
beforeEach(() => {
  h.rows = [{ id: 'row', account_id: 'account-a', waba_id: 'waba', business_id: 'business', status: 'pending', updated_at: '2026-10-30T09:59:00Z' }];
  h.writes = []; h.filters = []; h.lookupStatuses = []; h.updateStatuses = [];
  h.race = false; h.lookupError = false; h.writeError = false;
  h.client.mockClear(); h.update.mockClear();
});
describe('partner account_update', () => {
  it.each(['pending', 'error', 'disconnected', 'connected'])('acknowledges PARTNER_ADDED for %s without any DB access', async status => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      h.rows[0].status = status;
      await handlePartnerUpdate(event('PARTNER_ADDED'), time);
      expect(h.client).not.toHaveBeenCalled();
      expect(h.update).not.toHaveBeenCalled();
      expect(h.writes).toEqual([]);
      expect(h.rows[0].status).toBe(status);
      expect(log.mock.calls).toEqual([['[webhook] partner added acknowledged; complete signup to connect']]);
    } finally { log.mockRestore(); }
  });
  it('acknowledges PARTNER_ADDED for a WABA shared by two accounts without any DB access', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      h.rows.push({ ...h.rows[0], id: 'row-2', account_id: 'account-b', status: 'error' });
      const before = structuredClone(h.rows);
      await handlePartnerUpdate(event('PARTNER_ADDED'), time);
      expect(h.client).not.toHaveBeenCalled(); expect(h.update).not.toHaveBeenCalled();
      expect(h.writes).toEqual([]); expect(h.rows).toEqual(before);
    } finally { log.mockRestore(); }
  });
  it.each(['connected', 'pending', 'error'])('disconnects a %s row for a newer PARTNER_REMOVED', async status => {
    h.rows[0].status = status;
    await handlePartnerUpdate(event('PARTNER_REMOVED'), time);
    expect(h.rows[0].status).toBe('disconnected');
    expect(h.writes).toEqual([removedPatch]);
    expect(h.filters).toEqual([['id', 'row'], ['status', status], ['updated_at', '2026-10-30T09:59:00Z']]);
    expect(h.lookupStatuses).toEqual([['connected', 'pending', 'error']]);
    expect(h.updateStatuses).toEqual([['connected', 'pending', 'error']]);
  });
  it.each([time, time + 1])('skips a removal at or before updated_at (%s)', async updated => {
    h.rows[0].updated_at = new Date(updated * 1000).toISOString();
    await handlePartnerUpdate(event('PARTNER_REMOVED'), time);
    expect(h.update).not.toHaveBeenCalled(); expect(h.writes).toEqual([]);
  });
  it('writes only once for duplicate removal deliveries', async () => {
    await handlePartnerUpdate(event('PARTNER_REMOVED'), time);
    await handlePartnerUpdate(event('PARTNER_REMOVED'), time);
    expect(h.update).toHaveBeenCalledOnce(); expect(h.writes).toEqual([removedPatch]);
  });
  it('skips already-disconnected rows without a watermark write', async () => {
    h.rows[0].status = 'disconnected';
    await handlePartnerUpdate(event('PARTNER_REMOVED'), time);
    expect(h.update).not.toHaveBeenCalled(); expect(h.writes).toEqual([]);
    expect(h.rows[0].updated_at).toBe('2026-10-30T09:59:00Z');
  });
  it('disconnects matching phones across accounts while skipping disconnected rows', async () => {
    h.rows.push({ ...h.rows[0], id: 'row-2', account_id: 'account-b', status: 'error' });
    h.rows.push({ ...h.rows[0], id: 'row-3', status: 'disconnected' });
    await handlePartnerUpdate(event('PARTNER_REMOVED'), time);
    expect(h.writes).toEqual([removedPatch, removedPatch]);
  });
  it('logs an unknown WABA without writing or changing another WABA in the business', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await handlePartnerUpdate({ event: 'PARTNER_REMOVED', waba_info: { waba_id: 'unknown', owner_business_id: 'business' } }, time);
      expect(h.writes).toEqual([]); expect(h.update).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith('[webhook] unknown partner connection; skipping event');
      expect(h.lookupStatuses).toEqual([['connected', 'pending', 'error'], ['connected', 'pending', 'error']]);
    } finally { warn.mockRestore(); }
  });
  it('uses entry.id when waba_info is missing', async () => {
    await handlePartnerUpdate({ event: 'PARTNER_REMOVED' }, String(time), 'waba');
    expect(h.writes).toEqual([removedPatch]);
  });
  it('falls back to business_id when no WABA id is available', async () => {
    await handlePartnerUpdate({ event: 'PARTNER_REMOVED', waba_info: { owner_business_id: 'business' } }, time);
    expect(h.writes).toEqual([removedPatch]);
  });
  it.each([undefined, null, 'bad', 0])('skips missing/invalid event time %s', async time => {
    await handlePartnerUpdate(event('PARTNER_REMOVED'), time);
    expect(h.client).not.toHaveBeenCalled(); expect(h.writes).toEqual([]);
  });
  it('preserves a concurrent status change when CAS matches zero rows', async () => {
    h.race = true;
    await handlePartnerUpdate(event('PARTNER_REMOVED'), time);
    expect(h.update).toHaveBeenCalledOnce(); expect(h.writes).toEqual([]);
    expect(h.rows[0].status).toBe('disconnected');
    expect(h.rows[0].updated_at).toBe('2026-10-30T09:59:00Z');
  });
  it.each(['lookupError', 'writeError'] as const)('fails closed on %s', async key => {
    h[key] = true;
    await expect(handlePartnerUpdate(event('PARTNER_REMOVED'), time)).rejects.toThrow();
    expect(h.writes).toEqual([]);
  });
});
