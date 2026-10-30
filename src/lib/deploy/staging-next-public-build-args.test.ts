import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * NEXT_PUBLIC_* values are inlined into the browser bundle at
 * `next build`. If a var is read in `src/` but missing from the staging
 * Dockerfile ARG/ENV list, the client silently falls back (e.g. to
 * Voice's `public` schema). This test fails closed on that gap.
 */

const ROOT = process.cwd();
const DOCKERFILE = join(ROOT, 'deploy/staging/Dockerfile');
const SRC = join(ROOT, 'src');
const EXT = /\.(ts|tsx|js|jsx)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (EXT.test(name) && !/\.test\.(ts|tsx|js|jsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** NEXT_PUBLIC_* names referenced from production src. */
function nextPublicVarsFromSrc(): string[] {
  const found = new Set<string>();
  const re =
    /(?:process\.env|env)\.(NEXT_PUBLIC_[A-Z0-9_]+)|['"`](NEXT_PUBLIC_[A-Z0-9_]+)['"`]/g;
  for (const file of walk(SRC)) {
    const src = stripComments(readFileSync(file, 'utf8'));
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      found.add(m[1] ?? m[2]);
    }
  }
  return [...found].sort();
}

/** NEXT_PUBLIC_* declared as ARG and present on an ENV line in the Dockerfile. */
function nextPublicVarsFromDockerfile(dockerfile: string): {
  args: Set<string>;
  envs: Set<string>;
} {
  const args = new Set<string>();
  const envs = new Set<string>();
  for (const raw of dockerfile.split('\n')) {
    const line = raw.trim();
    const arg = line.match(/^ARG\s+(NEXT_PUBLIC_[A-Z0-9_]+)\b/);
    if (arg) args.add(arg[1]);
    // ENV can be single-line or continued with `\`.
    for (const m of line.matchAll(/\b(NEXT_PUBLIC_[A-Z0-9_]+)=/g)) {
      envs.add(m[1]);
    }
  }
  return { args, envs };
}

describe('staging Dockerfile inlines every NEXT_PUBLIC_* read in src', () => {
  it('declares ARG + ENV for each NEXT_PUBLIC_* used by the app', () => {
    const dockerfile = readFileSync(DOCKERFILE, 'utf8');
    const { args, envs } = nextPublicVarsFromDockerfile(dockerfile);
    const required = nextPublicVarsFromSrc();

    expect(required.length).toBeGreaterThan(0);

    const missingArg = required.filter((v) => !args.has(v));
    const missingEnv = required.filter((v) => !envs.has(v));

    expect(
      missingArg,
      `Missing ARG in ${relative(ROOT, DOCKERFILE)} (read in src/): ${missingArg.join(', ')}`,
    ).toEqual([]);
    expect(
      missingEnv,
      `Missing ENV in ${relative(ROOT, DOCKERFILE)} (read in src/): ${missingEnv.join(', ')}`,
    ).toEqual([]);
  });

  it('loads the callback state secret from env_file without overriding it', () => {
    const compose = readFileSync(join(ROOT, 'deploy/staging/docker-compose.staging.yml'), 'utf8');
    expect(compose).toMatch(/env_file:\s*\n\s*- \.env\.staging/);
    expect(compose).not.toMatch(/^\s*WACRM_ES_STATE_SECRET:/m);
  });

  it('compose fail-closes schema + bucket prefix build args and runtime env', () => {
    const compose = readFileSync(
      join(ROOT, 'deploy/staging/docker-compose.staging.yml'),
      'utf8',
    );
    expect(compose).toMatch(
      /NEXT_PUBLIC_SUPABASE_DB_SCHEMA:\s*\$\{NEXT_PUBLIC_SUPABASE_DB_SCHEMA:\?/,
    );
    expect(compose).toMatch(
      /NEXT_PUBLIC_STORAGE_BUCKET_PREFIX:\s*\$\{NEXT_PUBLIC_STORAGE_BUCKET_PREFIX:\?/,
    );
    expect(compose).toMatch(
      /SUPABASE_DB_SCHEMA:\s*\$\{SUPABASE_DB_SCHEMA:\?/,
    );
    expect(compose).toMatch(
      /STORAGE_BUCKET_PREFIX:\s*\$\{STORAGE_BUCKET_PREFIX:\?/,
    );
  });
});
