/**
 * Shared Supabase client options for schema isolation.
 *
 * On a shared Supabase project (Astra Voice live DB), Chat lives entirely
 * in Postgres schema `wacrm`. Local / single-tenant deploys keep the
 * historical default `public`.
 *
 * Storage bucket ids are similarly prefixable so Chat buckets never
 * collide with Voice (`NEXT_PUBLIC_STORAGE_BUCKET_PREFIX=wacrm-` →
 * `wacrm-avatars`).
 *
 * IMPORTANT: this module is imported by Client Components. It must ONLY
 * read `NEXT_PUBLIC_*` env vars. Referencing `SUPABASE_DB_SCHEMA` /
 * `STORAGE_BUCKET_PREFIX` here leaves those identifiers in the browser
 * chunk next to the inlined NEXT_PUBLIC values, which fails the brand
 * scrubber. Server runtime still sets the non-public names for
 * fail-closed compose checks; bake `NEXT_PUBLIC_*` at `next build`.
 */

export const DEFAULT_DB_SCHEMA = 'public';
export const DEFAULT_STORAGE_BUCKET_PREFIX = '';

/** Logical Chat storage bucket names (unprefixed). */
export const CHAT_STORAGE_BUCKETS = [
  'avatars',
  'flow-media',
  'chat-media',
] as const;

export type ChatStorageBucket = (typeof CHAT_STORAGE_BUCKETS)[number];

export function getSupabaseDbSchema(): string {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_DB_SCHEMA;
}

export function getStorageBucketPrefix(): string {
  // Explicit empty string is allowed (and is the default).
  if (process.env.NEXT_PUBLIC_STORAGE_BUCKET_PREFIX !== undefined) {
    return process.env.NEXT_PUBLIC_STORAGE_BUCKET_PREFIX;
  }
  return DEFAULT_STORAGE_BUCKET_PREFIX;
}

/** Resolve a logical bucket name to the deployed Storage id. */
export function storageBucket(logicalName: string): string {
  return `${getStorageBucketPrefix()}${logicalName}`;
}

/**
 * Options bag merged into every supabase-js / @supabase/ssr client so
 * `.from()` / `.rpc()` target the configured schema.
 */
export function supabaseDbOptions(): { db: { schema: string } } {
  return { db: { schema: getSupabaseDbSchema() } };
}
