/**
 * Consent ledger helpers (CHAT-11).
 *
 * Append-only writes to `consent_events` + updates `contacts.opted_out`.
 * Callers pass a Supabase client (user or service-role); every query is
 * account-scoped.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  detectConsentKeyword,
  type ConsentKeywordAction,
} from './keywords';

export type ConsentEventType = 'opt_out' | 'opt_in' | 'send_skipped';
export type ConsentEventSource =
  | 'inbound_keyword'
  | 'broadcast'
  | 'automation'
  | 'adapter'
  | 'manual'
  | 'system';

export interface ConsentContactRef {
  id: string;
  account_id?: string;
  opted_out?: boolean | null;
}

/** True when the contact row (or a hydrated join) is opted out. */
export function isOptedOut(
  contact: ConsentContactRef | null | undefined,
): boolean {
  return Boolean(contact?.opted_out);
}

export async function appendConsentEvent(
  db: SupabaseClient,
  args: {
    accountId: string;
    contactId: string;
    eventType: ConsentEventType;
    source: ConsentEventSource;
    keyword?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await db.from('consent_events').insert({
    account_id: args.accountId,
    contact_id: args.contactId,
    event_type: args.eventType,
    source: args.source,
    keyword: args.keyword ?? null,
    metadata: args.metadata ?? {},
  });
  if (error) {
    console.error('[consent] appendConsentEvent failed:', error.message);
  }
}

/**
 * Flip opted_out and append a ledger row. Idempotent for the flag
 * itself (re-STOP while already opted out still appends an event).
 */
export async function applyConsentAction(
  db: SupabaseClient,
  args: {
    accountId: string;
    contactId: string;
    action: ConsentKeywordAction;
    keyword: string;
    source?: ConsentEventSource;
  },
): Promise<{ optedOut: boolean }> {
  const optedOut = args.action === 'opt_out';
  const { error } = await db
    .from('contacts')
    .update({
      opted_out: optedOut,
      opted_out_at: optedOut ? new Date().toISOString() : null,
    })
    .eq('id', args.contactId)
    .eq('account_id', args.accountId);

  if (error) {
    console.error('[consent] applyConsentAction update failed:', error.message);
  }

  await appendConsentEvent(db, {
    accountId: args.accountId,
    contactId: args.contactId,
    eventType: optedOut ? 'opt_out' : 'opt_in',
    source: args.source ?? 'inbound_keyword',
    keyword: args.keyword,
  });

  return { optedOut };
}

/**
 * Process inbound customer text for STOP/START keywords. Returns the
 * detection result (or null) after persisting state when matched.
 */
export async function processInboundConsentKeyword(
  db: SupabaseClient,
  args: {
    accountId: string;
    contactId: string;
    text: string | null | undefined;
  },
): Promise<{ action: ConsentKeywordAction; keyword: string } | null> {
  const hit = detectConsentKeyword(args.text);
  if (!hit) return null;
  await applyConsentAction(db, {
    accountId: args.accountId,
    contactId: args.contactId,
    action: hit.action,
    keyword: hit.keyword,
  });
  return hit;
}

/**
 * Log a skipped proactive send and return true when the contact is
 * opted out. Callers should return early without sending to Meta.
 */
export async function skipIfOptedOut(
  db: SupabaseClient,
  args: {
    accountId: string;
    contactId: string;
    optedOut: boolean;
    source: Exclude<ConsentEventSource, 'inbound_keyword' | 'manual'>;
    metadata?: Record<string, unknown>;
  },
): Promise<boolean> {
  if (!args.optedOut) return false;
  await appendConsentEvent(db, {
    accountId: args.accountId,
    contactId: args.contactId,
    eventType: 'send_skipped',
    source: args.source,
    metadata: args.metadata ?? {},
  });
  return true;
}
