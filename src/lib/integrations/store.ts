import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getProviderMeta,
  type IntegrationConnectionStatus,
  type IntegrationProvider,
} from './catalog';
import {
  credentialPresence,
  decryptCredentials,
  encryptCredentials,
  type CredentialBag,
} from './credentials';
import { testProviderConnection } from './stub';
import { appendIntegrationEvent } from './event-log';

export interface IntegrationConnectionRow {
  id: string;
  account_id: string;
  provider: string;
  status: IntegrationConnectionStatus;
  credentials_encrypted: string | null;
  config: Record<string, unknown>;
  display_name: string | null;
  last_tested_at: string | null;
  last_error: string | null;
  connected_at: string | null;
  connected_by: string | null;
  updated_at: string;
  created_at: string;
}

export interface PublicIntegrationConnection {
  provider: IntegrationProvider;
  status: IntegrationConnectionStatus;
  display_name: string | null;
  config: Record<string, unknown>;
  credential_keys: Record<string, boolean>;
  last_tested_at: string | null;
  last_error: string | null;
  connected_at: string | null;
  updated_at: string | null;
}

export function toPublicConnection(
  row: IntegrationConnectionRow | null,
  provider: IntegrationProvider,
): PublicIntegrationConnection {
  if (!row) {
    return {
      provider,
      status: 'disconnected',
      display_name: null,
      config: {},
      credential_keys: {},
      last_tested_at: null,
      last_error: null,
      connected_at: null,
      updated_at: null,
    };
  }
  const bag = decryptCredentials(row.credentials_encrypted);
  return {
    provider,
    status: row.status,
    display_name: row.display_name,
    config: (row.config ?? {}) as Record<string, unknown>,
    credential_keys: credentialPresence(bag),
    last_tested_at: row.last_tested_at,
    last_error: row.last_error,
    connected_at: row.connected_at,
    updated_at: row.updated_at,
  };
}

export async function listConnections(
  supabase: SupabaseClient,
  accountId: string,
): Promise<IntegrationConnectionRow[]> {
  const { data, error } = await supabase
    .from('integration_connections')
    .select('*')
    .eq('account_id', accountId);
  if (error) throw error;
  return (data ?? []) as IntegrationConnectionRow[];
}

export async function getConnection(
  supabase: SupabaseClient,
  accountId: string,
  provider: IntegrationProvider,
): Promise<IntegrationConnectionRow | null> {
  const { data, error } = await supabase
    .from('integration_connections')
    .select('*')
    .eq('account_id', accountId)
    .eq('provider', provider)
    .maybeSingle();
  if (error) throw error;
  return (data as IntegrationConnectionRow | null) ?? null;
}

function splitFields(
  provider: IntegrationProvider,
  input: Record<string, unknown>,
): { credentials: CredentialBag; config: Record<string, unknown> } {
  const meta = getProviderMeta(provider);
  const secretKeys = new Set(
    (meta?.fields ?? []).filter((f) => f.secret || f.key.includes('secret') || f.key.includes('token') || f.key.includes('password')).map((f) => f.key),
  );
  // Treat all declared fields as credentials bag for encryption simplicity;
  // non-secret keys still go encrypted (safer) but also mirrored into config
  // when not marked secret so UI can show shop domain etc.
  const credentials: CredentialBag = {};
  const config: Record<string, unknown> = {};
  for (const field of meta?.fields ?? []) {
    const raw = input[field.key];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    credentials[field.key] = raw.trim();
    if (!field.secret && !secretKeys.has(field.key)) {
      config[field.key] = raw.trim();
    }
  }
  if (input.config && typeof input.config === 'object' && !Array.isArray(input.config)) {
    Object.assign(config, input.config as Record<string, unknown>);
  }
  return { credentials, config };
}

export async function connectIntegration(
  supabase: SupabaseClient,
  opts: {
    accountId: string;
    userId: string;
    provider: IntegrationProvider;
    fields: Record<string, unknown>;
    displayName?: string | null;
  },
): Promise<PublicIntegrationConnection> {
  const { credentials, config } = splitFields(opts.provider, opts.fields);
  const meta = getProviderMeta(opts.provider);
  for (const field of meta?.fields ?? []) {
    if (field.required && !credentials[field.key]) {
      throw new Error(`Missing required field: ${field.key}`);
    }
  }

  const now = new Date().toISOString();
  const row = {
    account_id: opts.accountId,
    provider: opts.provider,
    status: 'connected' as const,
    credentials_encrypted: encryptCredentials(credentials),
    config,
    display_name: opts.displayName?.trim() || meta?.name || opts.provider,
    connected_at: now,
    connected_by: opts.userId,
    last_error: null,
    updated_at: now,
  };

  const { data, error } = await supabase
    .from('integration_connections')
    .upsert(row, { onConflict: 'account_id,provider' })
    .select('*')
    .single();
  if (error) throw error;

  await appendIntegrationEvent(supabase, {
    accountId: opts.accountId,
    provider: opts.provider,
    eventType: 'connection.connected',
    status: 'success',
    message: `Connected ${opts.provider}`,
  });

  return toPublicConnection(data as IntegrationConnectionRow, opts.provider);
}

export async function disconnectIntegration(
  supabase: SupabaseClient,
  opts: { accountId: string; provider: IntegrationProvider },
): Promise<PublicIntegrationConnection> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('integration_connections')
    .upsert(
      {
        account_id: opts.accountId,
        provider: opts.provider,
        status: 'disconnected',
        credentials_encrypted: null,
        config: {},
        last_error: null,
        connected_at: null,
        connected_by: null,
        updated_at: now,
      },
      { onConflict: 'account_id,provider' },
    )
    .select('*')
    .single();
  if (error) throw error;

  await appendIntegrationEvent(supabase, {
    accountId: opts.accountId,
    provider: opts.provider,
    eventType: 'connection.disconnected',
    status: 'info',
    message: `Disconnected ${opts.provider}`,
  });

  return toPublicConnection(data as IntegrationConnectionRow, opts.provider);
}

export async function testIntegrationConnection(
  supabase: SupabaseClient,
  opts: { accountId: string; provider: IntegrationProvider },
): Promise<{
  connection: PublicIntegrationConnection;
  result: ReturnType<typeof testProviderConnection>;
}> {
  const existing = await getConnection(supabase, opts.accountId, opts.provider);
  const bag = decryptCredentials(existing?.credentials_encrypted);
  const result = testProviderConnection(opts.provider, bag);
  const now = new Date().toISOString();

  const patch = {
    account_id: opts.accountId,
    provider: opts.provider,
    status: (result.ok
      ? existing?.status === 'disconnected'
        ? 'disconnected'
        : 'connected'
      : 'error') as IntegrationConnectionStatus,
    last_tested_at: now,
    last_error: result.ok ? null : result.message,
    updated_at: now,
    credentials_encrypted: existing?.credentials_encrypted ?? null,
    config: existing?.config ?? {},
    display_name: existing?.display_name ?? null,
    connected_at: existing?.connected_at ?? null,
    connected_by: existing?.connected_by ?? null,
  };

  // Preserve connected status on successful test of an already-connected row.
  if (result.ok && existing?.status === 'connected') {
    patch.status = 'connected';
  }
  if (!result.ok) {
    patch.status = existing?.status === 'connected' ? 'error' : (existing?.status ?? 'disconnected');
  }

  const { data, error } = await supabase
    .from('integration_connections')
    .upsert(patch, { onConflict: 'account_id,provider' })
    .select('*')
    .single();
  if (error) throw error;

  await appendIntegrationEvent(supabase, {
    accountId: opts.accountId,
    provider: opts.provider,
    eventType: 'connection.test',
    status: result.ok ? 'success' : 'error',
    message: result.message,
    payload: { stub: result.stub, details: result.details ?? {} },
  });

  return {
    connection: toPublicConnection(data as IntegrationConnectionRow, opts.provider),
    result,
  };
}
