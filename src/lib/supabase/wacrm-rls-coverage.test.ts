import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Item 6 — every table in the shared-project pack must enable RLS and
 * declare at least one policy (member policies or explicit deny-all for
 * service-role-only tables).
 */

const SCHEMA_PATH = path.join(
  process.cwd(),
  'supabase/shared-project/wacrm_schema.sql',
);

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

describe('wacrm_schema.sql RLS coverage (item 6)', () => {
  const raw = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const sql = stripSqlComments(raw);

  const tables = [
    ...new Set(
      [...sql.matchAll(/CREATE\s+TABLE\s+wacrm\.(\w+)/gi)].map((m) =>
        m[1].toLowerCase(),
      ),
    ),
  ].sort();

  const rlsEnabled = new Set(
    [...sql.matchAll(/ALTER\s+TABLE\s+wacrm\.(\w+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi)].map(
      (m) => m[1].toLowerCase(),
    ),
  );

  const policyTables = new Set(
    [...sql.matchAll(/CREATE\s+POLICY\s+\S+\s+ON\s+wacrm\.(\w+)/gi)].map((m) =>
      m[1].toLowerCase(),
    ),
  );

  it('discovers Chat tables in the shared pack', () => {
    expect(tables.length).toBeGreaterThanOrEqual(40);
  });

  it('enables RLS on every wacrm table', () => {
    const missing = tables.filter((t) => !rlsEnabled.has(t));
    expect(missing).toEqual([]);
  });

  it('declares at least one policy on every wacrm table', () => {
    const missing = tables.filter((t) => !policyTables.has(t));
    expect(missing).toEqual([]);
  });

  it('keeps service-role-only metering tables behind deny-all policies', () => {
    expect(sql).toMatch(/CREATE\s+POLICY\s+astra_usage_daily_deny_all/i);
    expect(sql).toMatch(
      /CREATE\s+POLICY\s+automation_pending_executions_deny_all/i,
    );
  });
});
