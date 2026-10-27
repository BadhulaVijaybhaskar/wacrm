/**
 * CHAT-12 — every App Router `route.ts` under `src/app/api` must show an
 * auth gate in source. Unauthenticated access is covered by middleware
 * for session routes; this audit fails the build when a new route ships
 * without any of the known auth patterns.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const API_ROOT = join(process.cwd(), 'src/app/api');

const AUTH_PATTERNS = [
  /requireRole\s*\(/,
  /requireAuth\s*\(/,
  /requireApiKey\s*\(/,
  /getCurrentAccount\s*\(/,
  /getUser\s*\(/,
  /verifyMetaWebhookSignature/,
  /verifyConnectRequest|authenticateConnect|requireConnect|loadTenantByConnectId/,
  /CRON_SECRET/,
  /verifyMediaToken|mediaToken|signed media/i,
  /peekInvitation|redeemInvitation|invitation/,
  /Authorization|api[_-]?key/i,
];

/** Routes that intentionally use a non-cookie auth mechanism named above,
 *  or are middleware-gated public surfaces documented in the security review. */
const ALLOWLIST_RELATIVE: string[] = [
  // Cron routes authenticate via shared secret header inside the file.
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name === 'route.ts') out.push(full);
  }
  return out;
}

describe('API route auth audit (CHAT-12)', () => {
  const routes = walk(API_ROOT);

  it('discovers route handlers', () => {
    expect(routes.length).toBeGreaterThan(20);
  });

  for (const file of routes) {
    const rel = relative(process.cwd(), file);
    if (ALLOWLIST_RELATIVE.includes(rel)) continue;

    it(`${rel} contains an auth check`, () => {
      const src = readFileSync(file, 'utf8');
      const ok = AUTH_PATTERNS.some((re) => re.test(src));
      expect(
        ok,
        `${rel} has no recognisable auth gate (requireRole / getUser / API key / webhook HMAC / …)`,
      ).toBe(true);
    });
  }
});
