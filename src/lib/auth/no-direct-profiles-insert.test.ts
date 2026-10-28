import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * shared-sql-v3: authenticated loses INSERT on wacrm.profiles and
 * profiles_insert is dropped. The only allowed creator is the
 * SECURITY DEFINER RPC `ensure_chat_profile`. This test walks app
 * sources and fails if any client/server path still does
 * `.from('profiles').insert(...)`.
 */

const ROOT = join(process.cwd(), 'src');
const EXT = /\.(ts|tsx)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (EXT.test(name) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/** Strip block + line comments so commented examples don't trip the scan. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Match `.from('profiles'|'profiles').insert(` across whitespace/newlines.
 * Also catches chained builders that call insert immediately after from.
 */
const PROFILES_INSERT_RE =
  /\.from\(\s*['"]profiles['"]\s*\)[\s\S]{0,200}?\.insert\s*\(/g;

describe('no direct profiles inserts (shared-sql-v3)', () => {
  it('ensureChatProfile never falls back to profiles.insert', () => {
    const src = readFileSync(
      join(ROOT, 'lib/auth/ensure-chat-profile.ts'),
      'utf8',
    );
    expect(src).toMatch(/ensure_chat_profile/);
    expect(src).not.toMatch(/\.from\(\s*['"]profiles['"]\s*\)/);
    expect(src).not.toMatch(/\.insert\s*\(/);
  });

  it('no src/ file inserts into profiles directly', () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const raw = readFileSync(file, 'utf8');
      const src = stripComments(raw);
      if (PROFILES_INSERT_RE.test(src)) {
        offenders.push(relative(process.cwd(), file));
      }
      PROFILES_INSERT_RE.lastIndex = 0;
    }
    expect(offenders).toEqual([]);
  });
});
