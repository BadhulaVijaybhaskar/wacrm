import { createServiceClient } from '@/lib/supabase/admin';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}
function id(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** account_update value.waba_info is optional; entry.id is normally the WABA. */
export async function handlePartnerUpdate(value: unknown, time: unknown, entryId?: string) {
  const event = record(value);
  if (event.event !== 'PARTNER_ADDED' && event.event !== 'PARTNER_REMOVED') return;
  const info = record(event.waba_info);
  const wabaId = id(info.waba_id) || id(entryId);
  const businessId = id(info.owner_business_id);
  const seconds = typeof time === 'number' || (typeof time === 'string' && time.trim()) ? Number(time) : NaN;
  const millis = seconds * 1000;
  // Missing/invalid event time cannot safely order a status change. Fail closed.
  if (!Number.isFinite(millis) || millis <= 0 || millis > 8.64e15) return;
  const eventTime = new Date(millis).toISOString();
  const db = createServiceClient().schema('wacrm');
  const columns = 'id,status,updated_at,waba_id,business_id';
  let result = wabaId
    ? await db.from('wa_connections').select(columns).eq('waba_id', wabaId)
    : { data: [], error: null };
  if (result.error) throw new Error('partner_connection_lookup_failed');
  if (!result.data?.length && businessId) {
    result = await db.from('wa_connections').select(columns).eq('business_id', businessId);
    if (result.error) throw new Error('partner_connection_lookup_failed');
    // Business ownership alone must not change another WABA's connections.
    if (wabaId) result.data = result.data?.filter(row => row.waba_id === wabaId);
  }
  if (!result.data?.length) {
    console.warn('[webhook] unknown partner connection; skipping event');
    return;
  }
  const status = event.event === 'PARTNER_ADDED' ? 'connected' : 'disconnected';
  for (const row of result.data) {
    if (!Number.isFinite(Date.parse(row.updated_at)) || Date.parse(row.updated_at) >= millis) continue;
    // A newer same-status event still needs this safe no-op update to advance
    // the watermark, or a delayed opposite event could reverse it.
    // No event-time column exists. The DB trigger sets updated_at to receipt time.
    // Compare event time with that conservative watermark; CAS prevents races with
    // disconnect, transfer, provisioning, or another webhook after this read.
    const { error } = await db.from('wa_connections').update({ status, last_error: null })
      .eq('id', row.id).eq('status', row.status).eq('updated_at', row.updated_at)
      .lt('updated_at', eventTime);
    if (error) throw new Error('partner_connection_update_failed');
  }
}
