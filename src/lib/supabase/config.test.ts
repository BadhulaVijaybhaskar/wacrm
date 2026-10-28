import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_DB_SCHEMA,
  getStorageBucketPrefix,
  getSupabaseDbSchema,
  storageBucket,
  supabaseDbOptions,
} from './config';

describe('supabase config — schema + bucket prefix', () => {
  const prevSchema = process.env.SUPABASE_DB_SCHEMA;
  const prevPublicSchema = process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA;
  const prevPrefix = process.env.STORAGE_BUCKET_PREFIX;
  const prevPublicPrefix = process.env.NEXT_PUBLIC_STORAGE_BUCKET_PREFIX;

  afterEach(() => {
    if (prevSchema === undefined) delete process.env.SUPABASE_DB_SCHEMA;
    else process.env.SUPABASE_DB_SCHEMA = prevSchema;
    if (prevPublicSchema === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA = prevPublicSchema;
    }
    if (prevPrefix === undefined) delete process.env.STORAGE_BUCKET_PREFIX;
    else process.env.STORAGE_BUCKET_PREFIX = prevPrefix;
    if (prevPublicPrefix === undefined) {
      delete process.env.NEXT_PUBLIC_STORAGE_BUCKET_PREFIX;
    } else {
      process.env.NEXT_PUBLIC_STORAGE_BUCKET_PREFIX = prevPublicPrefix;
    }
  });

  it('defaults schema to public', () => {
    delete process.env.SUPABASE_DB_SCHEMA;
    delete process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA;
    expect(getSupabaseDbSchema()).toBe(DEFAULT_DB_SCHEMA);
    expect(supabaseDbOptions()).toEqual({ db: { schema: 'public' } });
  });

  it('honours SUPABASE_DB_SCHEMA=wacrm', () => {
    process.env.SUPABASE_DB_SCHEMA = 'wacrm';
    expect(getSupabaseDbSchema()).toBe('wacrm');
    expect(supabaseDbOptions().db.schema).toBe('wacrm');
  });

  it('falls back to NEXT_PUBLIC_SUPABASE_DB_SCHEMA', () => {
    delete process.env.SUPABASE_DB_SCHEMA;
    process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA = 'wacrm';
    expect(getSupabaseDbSchema()).toBe('wacrm');
    delete process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA;
  });

  it('defaults bucket prefix to empty and prefixes when set', () => {
    delete process.env.STORAGE_BUCKET_PREFIX;
    delete process.env.NEXT_PUBLIC_STORAGE_BUCKET_PREFIX;
    expect(getStorageBucketPrefix()).toBe('');
    expect(storageBucket('chat-media')).toBe('chat-media');

    process.env.STORAGE_BUCKET_PREFIX = 'wacrm-';
    expect(storageBucket('chat-media')).toBe('wacrm-chat-media');
    expect(storageBucket('avatars')).toBe('wacrm-avatars');
    expect(storageBucket('flow-media')).toBe('wacrm-flow-media');
  });
});

