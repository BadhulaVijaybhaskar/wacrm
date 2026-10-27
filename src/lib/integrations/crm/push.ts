import { createHmac, randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { decryptCredentials } from '@/lib/integrations/credentials';
import { appendIntegrationEvent } from '@/lib/integrations/event-log';
import { isIntegrationsStubMode } from '@/lib/integrations/stub';

export type CrmProvider = 'hubspot' | 'zoho' | 'astra_crm';

export interface CrmContactPayload {
  phone?: string | null;
  email?: string | null;
  name?: string | null;
  company?: string | null;
  summary?: string | null;
}

export interface FieldMap {
  phone?: string;
  email?: string;
  name?: string;
  company?: string;
  note?: string;
}

const DEFAULT_MAP: FieldMap = {
  phone: 'phone',
  email: 'email',
  name: 'firstname',
  company: 'company',
  note: 'body',
};

export function applyFieldMap(
  contact: CrmContactPayload,
  map: FieldMap = DEFAULT_MAP,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (contact.phone && map.phone) out[map.phone] = contact.phone;
  if (contact.email && map.email) out[map.email] = contact.email;
  if (contact.name && map.name) out[map.name] = contact.name;
  if (contact.company && map.company) out[map.company] = contact.company;
  if (contact.summary && map.note) out[map.note] = contact.summary;
  return out;
}

function dedupeKey(contact: CrmContactPayload): string | null {
  if (contact.phone) return `phone:${contact.phone.replace(/\D/g, '')}`;
  if (contact.email) return `email:${contact.email.trim().toLowerCase()}`;
  return null;
}

async function stubPush(
  provider: CrmProvider,
  mapped: Record<string, string>,
): Promise<{ externalId: string; stub: boolean }> {
  if (!isIntegrationsStubMode()) {
    throw new Error(
      `Live ${provider} push is not enabled. Set META_STUB=1 or INTEGRATIONS_STUB=1.`,
    );
  }
  return {
    externalId: `${provider}_stub_${randomUUID().slice(0, 8)}`,
    stub: true,
  };
}

/** Signed webhook body for Astra CRM. */
export function buildAstraCrmPayload(
  contact: CrmContactPayload,
  mapped: Record<string, string>,
): Record<string, unknown> {
  return {
    doctype: 'CRM Lead',
    mobile_no: contact.phone ?? null,
    email: contact.email ?? null,
    lead_name: contact.name ?? null,
    company_name: contact.company ?? null,
    notes: contact.summary ?? null,
    custom_fields: mapped,
  };
}

export function signAstraCrmBody(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export async function pushContactToCrm(
  db: SupabaseClient,
  opts: {
    accountId: string;
    provider: CrmProvider;
    contactId?: string | null;
    contact: CrmContactPayload;
    fieldMap?: FieldMap;
  },
): Promise<{ status: 'success' | 'deduped' | 'error'; externalId?: string }> {
  const key = dedupeKey(opts.contact);
  if (key) {
    const { data: prior } = await db
      .from('crm_push_log')
      .select('id, external_id, status')
      .eq('account_id', opts.accountId)
      .eq('provider', opts.provider)
      .eq('entity_type', 'contact')
      .contains('payload', { dedupe_key: key })
      .eq('status', 'success')
      .limit(1)
      .maybeSingle();
    if (prior?.external_id) {
      await db.from('crm_push_log').insert({
        account_id: opts.accountId,
        provider: opts.provider,
        entity_type: 'contact',
        contact_id: opts.contactId ?? null,
        external_id: prior.external_id,
        status: 'deduped',
        payload: { dedupe_key: key },
      });
      return { status: 'deduped', externalId: prior.external_id as string };
    }
  }

  const { data: conn } = await db
    .from('integration_connections')
    .select('credentials_encrypted, config, status')
    .eq('account_id', opts.accountId)
    .eq('provider', opts.provider)
    .maybeSingle();

  if (!conn || conn.status !== 'connected') {
    throw new Error(`${opts.provider} is not connected`);
  }

  const creds = decryptCredentials(conn.credentials_encrypted as string | null);
  const config = (conn.config ?? {}) as Record<string, unknown>;
  const fieldMap =
    opts.fieldMap ??
    ((config.field_map as FieldMap | undefined) ?? DEFAULT_MAP);
  const mapped = applyFieldMap(opts.contact, fieldMap);

  try {
    let externalId: string;
    if (opts.provider === 'astra_crm') {
      const url = creds.webhook_url;
      const secret = creds.signing_secret;
      if (!url || !secret) throw new Error('Astra CRM URL/secret missing');
      const bodyObj = buildAstraCrmPayload(opts.contact, mapped);
      const body = JSON.stringify(bodyObj);
      const signature = signAstraCrmBody(body, secret);
      if (!isIntegrationsStubMode()) {
        throw new Error('Live Astra CRM push disabled outside stub mode');
      }
      // Stub: do not fetch; pretend accepted.
      externalId = `astra_stub_${randomUUID().slice(0, 8)}`;
      void signature;
    } else {
      const result = await stubPush(opts.provider, mapped);
      externalId = result.externalId;
    }

    await db.from('crm_push_log').insert({
      account_id: opts.accountId,
      provider: opts.provider,
      entity_type: opts.contact.summary ? 'conversation_summary' : 'contact',
      contact_id: opts.contactId ?? null,
      external_id: externalId,
      status: 'success',
      attempt: 1,
      payload: { dedupe_key: key, mapped },
    });

    await appendIntegrationEvent(db, {
      accountId: opts.accountId,
      provider: opts.provider,
      eventType: 'crm.push',
      status: 'success',
      message: `Pushed contact → ${externalId}`,
    });

    return { status: 'success', externalId };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'push failed';
    await db.from('crm_push_log').insert({
      account_id: opts.accountId,
      provider: opts.provider,
      entity_type: 'contact',
      contact_id: opts.contactId ?? null,
      status: 'error',
      attempt: 1,
      last_error: message,
      payload: { dedupe_key: key, mapped },
    });
    return { status: 'error' };
  }
}
