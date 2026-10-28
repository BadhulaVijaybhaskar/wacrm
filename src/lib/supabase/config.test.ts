import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_DB_SCHEMA,
  getStorageBucketPrefix,
  getSupabaseDbSchema,
  storageBucket,
  supabaseDbOptions,
} from './config';

describe('supabase config — schema + bucket prefix', () => {
  const prevPublicSchema = process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA;
  const prevPublicPrefix = process.env.NEXT_PUBLIC_STORAGE_BUCKET_PREFIX;

  afterEach(() => {
    if (prevPublicSchema === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA = prevPublicSchema;
    }
    if (prevPublicPrefix === undefined) {
      delete process.env.NEXT_PUBLIC_STORAGE_BUCKET_PREFIX;
    } else {
      process.env.NEXT_PUBLIC_STORAGE_BUCKET_PREFIX = prevPublicPrefix;
    }
  });

  it('defaults schema to public when NEXT_PUBLIC unset', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA;
    expect(getSupabaseDbSchema()).toBe(DEFAULT_DB_SCHEMA);
    expect(supabaseDbOptions()).toEqual({ db: { schema: 'public' } });
  });

  it('honours NEXT_PUBLIC_SUPABASE_DB_SCHEMA only (not server SUPABASE_DB_SCHEMA)', () => {
    process.env.SUPABASE_DB_SCHEMA = 'should-be-ignored';
    process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA = 'wacrm';
    expect(getSupabaseDbSchema()).toBe('wacrm');
    expect(supabaseDbOptions().db.schema).toBe('wacrm');
    delete process.env.SUPABASE_DB_SCHEMA;
  });

  it('ignores server-only SUPABASE_DB_SCHEMA when NEXT_PUBLIC unset', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA;
    process.env.SUPABASE_DB_SCHEMA = 'wacrm';
    expect(getSupabaseDbSchema()).toBe('public');
    delete process.env.SUPABASE_DB_SCHEMA;
  });

  it('defaults bucket prefix to empty and prefixes from NEXT_PUBLIC only', () => {
    delete process.env.NEXT_PUBLIC_STORAGE_BUCKET_PREFIX;
    expect(getStorageBucketPrefix()).toBe('');
    expect(storageBucket('chat-media')).toBe('chat-media');

    process.env.STORAGE_BUCKET_PREFIX = 'server-only-';
    expect(storageBucket('chat-media')).toBe('chat-media');
    delete process.env.STORAGE_BUCKET_PREFIX;

    process.env.NEXT_PUBLIC_STORAGE_BUCKET_PREFIX = 'wacrm-';
    expect(storageBucket('chat-media')).toBe('wacrm-chat-media');
    expect(storageBucket('avatars')).toBe('wacrm-avatars');
    expect(storageBucket('flow-media')).toBe('wacrm-flow-media');
  });

  it('never hard-codes a wacrm fallback in source', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./config.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/['"]wacrm['"]/);
    expect(src).not.toMatch(/['"]wacrm-['"]/);
    expect(src).not.toMatch(/process\.env\.SUPABASE_DB_SCHEMA\b/);
    expect(src).not.toMatch(/process\.env\.STORAGE_BUCKET_PREFIX\b/);
  });
});
