import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handlePartnerUpdate } from './partner-update';

const h = vi.hoisted(() => ({
  rows: [] as Record<string, string>[], writes: [] as Record<string, unknown>[],
  filters: [] as [string, unknown][], race: false, lookupError: false, writeError: false,
}));
vi.mock('@/lib/supabase/admin', () => ({ createServiceClient: () => ({
  schema: (schema: string) => {
    expect(schema).toBe('wacrm');
    return { from: (table: string) => {
      expect(table).toBe('wa_connections');
      return {
        select: () => ({ eq: async (key: string, value: unknown) => ({
          data: h.rows.filter(row => row[key] === value).map(row => ({...row})), error: h.lookupError ? {} : null,
        }) }),
        update: (patch: Record<string, unknown>) => {
          const filters: [string, unknown][] = [];
          const q = {
            eq: (key: string, value: unknown) => { filters.push([key, value]); return q; },
            lt: async (key: string, value: string) => {
              h.filters = filters;
              if (h.race) h.rows[0].updated_at = '2026-10-30T12:00:00Z';
              for (const row of h.rows) {
                if (filters.every(([k,v]) => row[k] === v) && Date.parse(row[key]) < Date.parse(value) && !h.writeError) {
                  h.writes.push(patch);Object.assign(row,patch,{updated_at:new Date(Date.parse(value)+5000).toISOString()});
                }
              }
              return { error: h.writeError ? {} : null };
            },
          };return q;
        },
      };
    } };
  },
}) }));
const time = Date.parse('2026-10-30T10:00:00Z') / 1000;
const event = (event: string) => ({ event, waba_info: { waba_id: 'waba', owner_business_id: 'business' } });
beforeEach(() => {
  h.rows = [{id:'row',waba_id:'waba',business_id:'business',status:'pending',updated_at:'2026-10-30T09:59:00Z'}];
  h.writes=[];h.filters=[];h.race=false;h.lookupError=false;h.writeError=false;
});
describe('partner account_update', () => {
  it.each([['PARTNER_ADDED','pending','connected'],['PARTNER_REMOVED','connected','disconnected']])('%s updates the status', async (name, before, after) => {
    h.rows[0].status=before;await handlePartnerUpdate(event(name),time);
    expect(h.rows[0].status).toBe(after);expect(h.writes).toEqual([{status:after,last_error:null}]);
    expect(h.filters).toContainEqual(['status',before]);expect(h.filters).toContainEqual(['updated_at','2026-10-30T09:59:00Z']);
  });
  it('does not write duplicate added/removed deliveries',async()=>{
    await handlePartnerUpdate(event('PARTNER_ADDED'),time);
    await handlePartnerUpdate(event('PARTNER_ADDED'),time);
    await handlePartnerUpdate(event('PARTNER_REMOVED'),time+20);
    await handlePartnerUpdate(event('PARTNER_REMOVED'),time+20);
    expect(h.writes).toHaveLength(2);
  });
  it.each([['disconnected','PARTNER_REMOVED','PARTNER_ADDED'],['connected','PARTNER_ADDED','PARTNER_REMOVED']])(
    'advances the watermark for a newer event on an already %s row',async(status,newer,older)=>{
      h.rows[0].status=status;
      await handlePartnerUpdate(event(newer),time);
      await handlePartnerUpdate(event(older),time-10);
      expect(h.rows[0].status).toBe(status);expect(h.writes).toHaveLength(1);
    });
  it('updates every matching phone in a shared WABA',async()=>{
    h.rows.push({...h.rows[0],id:'row-2'});
    await handlePartnerUpdate(event('PARTNER_ADDED'),time);
    expect(h.rows.every(row=>row.status==='connected')).toBe(true);expect(h.writes).toHaveLength(2);
  });
  it('does not resurrect a connection from an older added event',async()=>{
    await handlePartnerUpdate(event('PARTNER_REMOVED'),time);
    await handlePartnerUpdate(event('PARTNER_ADDED'),time-10);
    expect(h.rows[0].status).toBe('disconnected');expect(h.writes).toHaveLength(1);
  });
  it('does not remove a connection from an older removed event',async()=>{
    await handlePartnerUpdate(event('PARTNER_ADDED'),time);
    await handlePartnerUpdate(event('PARTNER_REMOVED'),time-10);
    expect(h.rows[0].status).toBe('connected');expect(h.writes).toHaveLength(1);
  });
  it('logs an unknown WABA without writing or changing another WABA in the business',async()=>{
    const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
    await handlePartnerUpdate({event:'PARTNER_ADDED',waba_info:{waba_id:'unknown',owner_business_id:'business'}},time);
    expect(h.writes).toEqual([]);expect(warn).toHaveBeenCalledWith('[webhook] unknown partner connection; skipping event');warn.mockRestore();
  });
  it('uses entry.id when waba_info is missing',async()=>{
    await handlePartnerUpdate({event:'PARTNER_ADDED'},String(time),'waba');expect(h.writes).toHaveLength(1);
  });
  it('falls back to business_id when no WABA id is available',async()=>{
    await handlePartnerUpdate({event:'PARTNER_ADDED',waba_info:{owner_business_id:'business'}},time);expect(h.writes).toHaveLength(1);
  });
  it.each([undefined,null,'bad',0])('skips missing/invalid event time %s',async time=>{
    await handlePartnerUpdate(event('PARTNER_ADDED'),time);expect(h.writes).toEqual([]);
  });
  it('uses compare-and-swap to preserve a concurrent change',async()=>{
    h.race=true;await handlePartnerUpdate(event('PARTNER_ADDED'),time);expect(h.writes).toEqual([]);
  });
  it.each(['lookupError','writeError'] as const)('fails closed on %s',async key=>{
    h[key]=true;await expect(handlePartnerUpdate(event('PARTNER_ADDED'),time)).rejects.toThrow();expect(h.writes).toEqual([]);
  });
});
