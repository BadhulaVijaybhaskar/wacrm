import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { supabaseDbOptions } from '@/lib/supabase/config';

// Schema is runtime-configurable — loosen SchemaName generics.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySchemaClient = SupabaseClient<any, any, any>;

/**
 * Shared service-role client. Every server path that previously minted
 * its own `createClient(url, serviceRoleKey)` should call this so the
 * configured `SUPABASE_DB_SCHEMA` is applied once.
 */
let _admin: AnySchemaClient | null = null;

export function createServiceClient(): AnySchemaClient {
  if (_admin) return _admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase admin credentials not configured');
  }
  _admin = createClient(url, key, {
    ...supabaseDbOptions(),
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}

/** Test helper — drop the singleton between cases. */
export function __resetServiceClientForTests() {
  _admin = null;
}
