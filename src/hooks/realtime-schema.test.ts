import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Shared-sql-v2: every postgres_changes filter must use
 * getSupabaseDbSchema() so SUPABASE_DB_SCHEMA=wacrm works on the
 * shared project. Hard-coded schema: "public" would miss wacrm tables.
 */
const REALTIME_FILES = [
  'src/hooks/use-realtime.ts',
  'src/hooks/use-browser-notifications.ts',
  'src/hooks/use-presence.ts',
  'src/hooks/use-total-unread.ts',
  'src/hooks/use-unread-notifications.ts',
  'src/components/inbox/message-thread.tsx',
  'src/app/(dashboard)/notifications/page.tsx',
];

describe('realtime postgres_changes schema', () => {
  it('never hard-codes schema public in postgres_changes filters', () => {
    for (const rel of REALTIME_FILES) {
      const src = readFileSync(join(process.cwd(), rel), 'utf8');
      expect(src, rel).toMatch(/getSupabaseDbSchema\(\)/);
      expect(src, rel).not.toMatch(/schema:\s*["']public["']/);
    }
  });
});
