import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

import { supabaseDbOptions } from '@/lib/supabase/config'

// Schema name is runtime-configurable (public | wacrm), so we cannot pin
// the SupabaseClient SchemaName generic to the literal "public".
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySchemaClient = SupabaseClient<any, any, any>

// Singleton instance — one client shared across the whole browser session.
// Creating multiple clients causes auth-lock contention ("Lock was released
// because another request stole it") and intermittent fetch failures.
let browserClient: AnySchemaClient | undefined

export function createClient(): AnySchemaClient {
  if (browserClient) return browserClient

  browserClient = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    supabaseDbOptions(),
  )

  return browserClient
}
