import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SCHEMA_PATH = path.join(process.cwd(), 'supabase/shared-project/wacrm_schema.sql');

function stripSqlComments(sql: string): string {
  let out = '';
  let i = 0;
  let inStr: "'" | '"' | null = null;
  while (i < sql.length) {
    if (inStr) {
      out += sql[i];
      if (sql[i] === inStr && sql[i - 1] !== '\\') inStr = null;
      i++;
      continue;
    }
    if (sql.startsWith('--', i)) {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl + 1;
      continue;
    }
    if (sql[i] === "'" || sql[i] === '"') {
      inStr = sql[i] as "'" | '"';
      out += sql[i];
      i++;
      continue;
    }
    out += sql[i];
    i++;
  }
  return out;
}

describe('wacrm_schema.sql safety', () => {
  const raw = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const sql = stripSqlComments(raw);
  it('exists and is non-empty', () => {
    expect(raw.length).toBeGreaterThan(1000);
  });

  it('has no forbidden top-level DDL on auth/public/storage (except allowed patterns)', () => {
    const lines = sql.split('\n');
    let inFunction = false;
    for (const line of lines) {
      if (/CREATE\s+OR\s+REPLACE\s+FUNCTION/i.test(line)) inFunction = true;
      if (inFunction && /^\$\$\s*LANGUAGE/i.test(line.trim())) inFunction = false;
      const t = line.trim();
      if (!t || t.startsWith('--')) continue;
      if (inFunction) continue;
      if (/^(DROP|TRUNCATE|DELETE|UPDATE)\b/i.test(t)) {
        throw new Error(`Forbidden top-level statement: ${t.slice(0, 120)}`);
      }
      if (/^ALTER\s+TABLE\s+(auth|public|storage)\./i.test(t)) {
        throw new Error(`ALTER on shared schema: ${t}`);
      }
      if (
        /^ALTER\b/i.test(t) &&
        !/^ALTER\s+TABLE\s+wacrm\./i.test(t) &&
        !/^ALTER\s+FUNCTION\s+wacrm\./i.test(t)
      ) {
        throw new Error(`ALTER must target wacrm only: ${t}`);
      }
    }
  });

  it('does not create triggers on auth/public/storage', () => {
    expect(sql).not.toMatch(/CREATE\s+TRIGGER[\s\S]+ON\s+auth\./i);
    expect(sql).not.toMatch(/CREATE\s+TRIGGER[\s\S]+ON\s+public\./i);
    expect(sql).not.toMatch(/CREATE\s+TRIGGER[\s\S]+ON\s+storage\./i);
  });

  it('qualifies CREATE TABLE/TYPE/FUNCTION/INDEX/POLICY targets with wacrm', () => {
    const flat = sql.replace(/\s+/g, ' ');
    const policyHits = flat.match(/CREATE\s+POLICY\s+[^;]+;/gi) ?? [];
    for (const pol of policyHits) {
      if (!/\sON\s+wacrm\.\w+/i.test(pol)) {
        throw new Error(`Unqualified CREATE POLICY: ${pol.slice(0, 100)}`);
      }
    }
    const indexHits = flat.match(/CREATE\s+(?:UNIQUE\s+)?INDEX[^;]+;/gi) ?? [];
    for (const idx of indexHits) {
      if (!/\sON\s+wacrm\./i.test(idx)) {
        throw new Error(`Unqualified CREATE INDEX: ${idx.slice(0, 100)}`);
      }
    }
    const lines = sql.split('\n').map((l) => l.trim());
    for (const line of lines) {
      if (!line || line.startsWith('--')) continue;
      if (/^CREATE\s+TABLE\s+(?!wacrm\.)/i.test(line)) {
        throw new Error(`Unqualified CREATE TABLE: ${line}`);
      }
      if (/^CREATE\s+TYPE\s+(?!wacrm\.)/i.test(line)) {
        throw new Error(`Unqualified CREATE TYPE: ${line}`);
      }
      if (/^CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?!wacrm\.)/i.test(line)) {
        throw new Error(`Unqualified CREATE FUNCTION: ${line}`);
      }
    }
  });

  it('includes ensure_chat_profile and not handle_new_user auth trigger', () => {
    expect(sql).toMatch(/wacrm\.ensure_chat_profile/i);
    expect(sql).not.toMatch(/handle_new_user/i);
    expect(sql).not.toMatch(/ON\s+auth\.users/i);
  });

  it('has no top-level procedural debris (END IF / END $$ outside functions)', () => {
    let inFunction = false;
    for (const line of sql.split('\n')) {
      if (/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i.test(line)) inFunction = true;
      if (inFunction && /\$\$\s*;?\s*$/.test(line.trim()) && !/AS\s+\$\$/i.test(line)) {
        // Closing body dollar-quote — next lines are out of function
        // until LANGUAGE / OWNER; keep inFunction until we see a blank
        // after $$; for simplicity clear on bare END $$;
        if (/^\$\$;?\s*$/i.test(line.trim()) || /\$\$\s*;\s*$/.test(line.trim())) {
          inFunction = false;
        }
      }
      if (inFunction) continue;
      const t = line.trim();
      if (/^END\s+IF\s*;?\s*$/i.test(t) || /^END\s+\$\$\s*;?\s*$/i.test(t)) {
        throw new Error(`Top-level procedural debris: ${t}`);
      }
    }
  });

  it('creates accounts before account_invitations (FK order)', () => {
    const accountsAt = raw.indexOf('CREATE TABLE wacrm.accounts');
    const invitesAt = raw.indexOf('CREATE TABLE wacrm.account_invitations');
    expect(accountsAt).toBeGreaterThan(-1);
    expect(invitesAt).toBeGreaterThan(-1);
    expect(accountsAt).toBeLessThan(invitesAt);
  });
});
