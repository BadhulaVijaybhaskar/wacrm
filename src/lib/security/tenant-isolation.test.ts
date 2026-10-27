/**
 * CHAT-12 — account-scoping helpers must never query without account_id.
 * These are unit-level guards; full RLS is enforced in Postgres policies
 * (migrations 017+) and cannot be exercised without a live DB.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCOPED_MODULES = [
  'src/lib/whatsapp/send-message.ts',
  'src/lib/automations/meta-send.ts',
  'src/lib/whatsapp/broadcast-core.ts',
  'src/lib/astra-connect/read-api.ts',
  'src/lib/consent/ledger.ts',
];

describe('tenant isolation — account_id in hot paths', () => {
  for (const rel of SCOPED_MODULES) {
    it(`${rel} scopes queries by account_id`, () => {
      const src = readFileSync(join(process.cwd(), rel), 'utf8');
      expect(src).toMatch(/account_id|accountId/);
      // Service-role / admin clients must still filter by account.
      if (src.includes('supabaseAdmin') || src.includes('service')) {
        expect(src).toMatch(/\.eq\(\s*['"]account_id['"]/);
      }
    });
  }
});
