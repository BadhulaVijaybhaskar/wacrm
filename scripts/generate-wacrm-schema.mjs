#!/usr/bin/env node
/**
 * Consolidates supabase/migrations/001–058 into a CREATE-only wacrm schema pack.
 * Run: node scripts/generate-wacrm-schema.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase/migrations');
const OUT_DIR = path.join(ROOT, 'supabase/shared-project');
const OUT_FILE = path.join(OUT_DIR, 'wacrm_schema.sql');

const SKIP_FUNCTION_NAMES = new Set(['handle_new_user']);

/** Tables owned by Chat (public schema in migrations). */
const APP_TABLES = new Set([
  'profiles',
  'contacts',
  'tags',
  'contact_tags',
  'custom_fields',
  'contact_custom_values',
  'contact_notes',
  'conversations',
  'messages',
  'whatsapp_config',
  'message_templates',
  'pipelines',
  'pipeline_stages',
  'deals',
  'broadcasts',
  'broadcast_recipients',
  'automations',
  'automation_steps',
  'automation_logs',
  'automation_pending_executions',
  'message_reactions',
  'flows',
  'flow_nodes',
  'flow_runs',
  'flow_run_events',
  'accounts',
  'account_invitations',
  'member_presence',
  'api_keys',
  'notifications',
  'webhook_endpoints',
  'ai_configs',
  'ai_knowledge_documents',
  'ai_knowledge_chunks',
  'ai_usage_log',
  'quick_replies',
  'consent_events',
  'astra_connect_handoff_audit',
  'astra_usage_daily',
  'integration_connections',
  'integration_event_log',
  'webhook_delivery_queue',
  'ecommerce_orders',
  'ecommerce_notify_queue',
  'product_catalog_items',
  'payment_links',
  'sheets_sync_runs',
  'crm_push_log',
  'ad_attributions',
  'intents',
  'intent_training_phrases',
  'intent_entities',
]);

function listMigrations() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .sort();
}

function splitStatements(sql) {
  const stmts = [];
  let buf = '';
  let i = 0;
  let inStr = null;
  let lineComment = false;
  let blockComment = false;

  while (i < sql.length) {
    if (lineComment) {
      const ch = sql[i];
      buf += ch;
      i++;
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (sql.startsWith('*/', i)) {
        buf += '*/';
        i += 2;
        blockComment = false;
        continue;
      }
      buf += sql[i];
      i++;
      continue;
    }
    if (inStr) {
      const ch = sql[i];
      const prev = sql[i - 1];
      buf += ch;
      i++;
      if (ch === inStr && prev !== '\\') inStr = null;
      continue;
    }
    if (sql.startsWith('--', i)) {
      lineComment = true;
      buf += '--';
      i += 2;
      continue;
    }
    if (sql.startsWith('/*', i)) {
      blockComment = true;
      buf += '/*';
      i += 2;
      continue;
    }
    if (sql[i] === '$') {
      const rest = sql.slice(i);
      const m = rest.match(/^(\$[a-zA-Z_0-9]*\$)/);
      if (m) {
        const tag = m[1];
        const close = sql.indexOf(tag, i + tag.length);
        if (close === -1) {
          buf += sql.slice(i);
          break;
        }
        buf += sql.slice(i, close + tag.length);
        i = close + tag.length;
        continue;
      }
    }
    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      inStr = ch;
      buf += ch;
      i++;
      continue;
    }
    if (ch === ';') {
      const trimmed = buf.trim();
      if (trimmed) stmts.push(trimmed);
      buf = '';
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  const tail = buf.trim();
  if (tail) stmts.push(tail);
  return stmts;
}

function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, '');
}

function normalizeWs(s) {
  return s.replace(/\s+/g, ' ').trim();
}

function splitTableItems(body) {
  const items = [];
  let cur = '';
  let depth = 0;
  let inStr = null;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    const prev = body[i - 1];
    if (inStr) {
      cur += c;
      if (c === inStr && prev !== '\\') inStr = null;
      continue;
    }
    if (c === "'" || c === '"') {
      inStr = c;
      cur += c;
      continue;
    }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      items.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) items.push(cur.trim());
  return items.filter(Boolean);
}

function stripSqlCommentsPreservingStrings(sql) {
  // Remove -- line and /* */ block comments without eating string literals.
  let out = '';
  let i = 0;
  let inStr = null;
  while (i < sql.length) {
    if (inStr) {
      out += sql[i];
      if (sql[i] === inStr && sql[i - 1] !== '\\') inStr = null;
      i++;
      continue;
    }
    if (sql[i] === "'" || sql[i] === '"') {
      inStr = sql[i];
      out += sql[i];
      i++;
      continue;
    }
    if (sql.startsWith('--', i)) {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl + 1;
      out += '\n';
      continue;
    }
    if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += ' ';
      continue;
    }
    out += sql[i];
    i++;
  }
  return out;
}

function parseCreateTable(stmt) {
  const m = stmt.match(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?("?[\w]+"?)\s*\(([\s\S]*)\)\s*;?$/i,
  );
  if (!m) return null;
  const rawName = m[1].replace(/"/g, '');
  if (!APP_TABLES.has(rawName)) return null;
  // Strip comments BEFORE comma-splitting — migration comments contain commas.
  const body = stripSqlCommentsPreservingStrings(m[2]);
  return { table: rawName, items: splitTableItems(body) };
}

function isConstraintItem(item) {
  const u = item.toUpperCase();
  return (
    u.startsWith('CONSTRAINT ') ||
    u.startsWith('PRIMARY KEY') ||
    u.startsWith('UNIQUE ') ||
    u.startsWith('CHECK ') ||
    u.startsWith('FOREIGN KEY')
  );
}

function expandTableItems(items) {
  const out = [];
  for (const item of items) {
    const cleaned = stripLineComments(item);
    if (!cleaned) continue;
    if (cleaned.includes(',') && !isConstraintItem(cleaned)) {
      for (const sub of splitTableItems(cleaned)) {
        const s = sub.trim();
        if (s) out.push(s);
      }
    } else {
      out.push(cleaned);
    }
  }
  return out;
}

function stripLineComments(fragment) {
  return fragment
    .split('\n')
    .map((line) => line.replace(/--.*$/, '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

function colNameFromItem(item) {
  const cleaned = stripLineComments(item);
  const m = cleaned.match(/^"([^"]+)"\s+/);
  if (m) return m[1];
  const m2 = cleaned.match(/^(\w+)\s+/);
  return m2 ? m2[1] : null;
}

function qualifyIdentifiers(sql) {
  let s = sql;
  s = s.replace(/\bpublic\./gi, 'wacrm.');
  s = s.replace(/\bSET\s+search_path\s*=\s*public\b/gi, 'SET search_path = wacrm, extensions');
  s = s.replace(/\bREFERENCES\s+(?!wacrm\.|auth\.)(\w+)\s*\(/gi, 'REFERENCES wacrm.$1(');
  s = s.replace(/\bON\s+(DELETE|UPDATE)\b/gi, 'ON $1');
  s = s.replace(
    /\bON\s+(?!wacrm\.|storage\.|auth\.)(\w+)\b/gi,
    (match, tbl) => (APP_TABLES.has(tbl) ? `ON wacrm.${tbl}` : match),
  );
  s = s.replace(
    /\b(FROM|JOIN)\s+(?!wacrm\.|auth\.)(\w+)\b/gi,
    (match, kw, tbl) => (APP_TABLES.has(tbl) ? `${kw} wacrm.${tbl}` : match),
  );
  s = s.replace(
    /\b(UPDATE|INSERT\s+INTO)\s+(?!wacrm\.|auth\.)(\w+)\b/gi,
    (match, kw, tbl) => (APP_TABLES.has(tbl) ? `${kw} wacrm.${tbl}` : match),
  );
  s = s.replace(/\bwacrm\.wacrm\./g, 'wacrm.');
  s = s.replace(/\bwacrm\.auth\./g, 'auth.');
  // Qualify enum type only when not already schema-qualified.
  s = s.replace(/(?<![\w.])account_role_enum\b/g, 'wacrm.account_role_enum');
  s = s.replace(
    /\bFUNCTION\s+(?!wacrm\.)(\w+)\s*\(/gi,
    (m, name) => `FUNCTION wacrm.${name}(`,
  );
  s = s.replace(/\bEXECUTE\s+FUNCTION\s+(?!wacrm\.)(\w+)/gi, 'EXECUTE FUNCTION wacrm.$1');
  return s;
}

const state = {
  types: new Map(),
  tables: new Map(),
  indexes: new Map(),
  policies: new Map(),
  triggers: new Map(),
  functions: new Map(),
  grants: [],
  revokes: [],
  replicaIdentity: new Map(),
  rlsTables: new Set(),
  extensions: new Set(['uuid-ossp', 'vector']),
};

function ensureTable(name) {
  if (!state.tables.has(name)) {
    state.tables.set(name, {
      columns: new Map(),
      constraints: new Map(),
      inlineChecks: [],
    });
  }
  return state.tables.get(name);
}

function stmtSql(stmt) {
  const lines = stmt.split('\n');
  let i = 0;
  while (i < lines.length && (/^\s*--/.test(lines[i]) || lines[i].trim() === '')) i++;
  const s = lines.slice(i).join('\n').trimStart();
  const idx = s.search(/\b(CREATE|ALTER|GRANT|REVOKE|COMMENT)\b/i);
  return idx >= 0 ? s.slice(idx) : s;
}

function leadingCode(stmt) {
  // Skip leading SQL comments / blank lines so DO-block detection works
  // when a migration header comment shares a statement with the first DO.
  const lines = stmt.split('\n');
  let i = 0;
  while (i < lines.length && (/^\s*--/.test(lines[i]) || lines[i].trim() === '')) {
    i++;
  }
  return lines.slice(i).join('\n').trimStart();
}

function processStatement(stmt) {
  const raw = leadingCode(stmt);
  // Handle DO blocks BEFORE stmtSql — stmtSql would otherwise slice into the
  // first CREATE/ALTER inside the block and leave END IF debris.
  if (/^DO\s+\$\$/i.test(raw) || /^DO\s+\$[a-zA-Z_0-9]*\$/i.test(raw)) {
    if (/CREATE\s+TYPE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?account_role_enum/i.test(raw)) {
      state.types.set(
        'account_role_enum',
        "CREATE TYPE wacrm.account_role_enum AS ENUM ('owner', 'admin', 'agent', 'viewer');",
      );
    }
    return;
  }

  const core = stmtSql(stmt);
  const upper = stripComments(core).toUpperCase();

  if (
    upper.includes('STORAGE.') ||
    upper.includes('ON AUTH.USERS') ||
    upper.includes('SUPABASE_REALTIME') ||
    upper.includes('PG_PUBLICATION') ||
    upper.includes('PG_CRON') ||
    upper.includes('CRON.SCHEDULE')
  ) {
    return;
  }
  if (upper.includes('HANDLE_NEW_USER')) return;

  if (/^CREATE\s+EXTENSION/i.test(core)) {
    if (/vector/i.test(stmt)) state.extensions.add('vector');
    if (/uuid-ossp/i.test(stmt)) state.extensions.add('uuid-ossp');
    return;
  }

  if (/^DROP\s/i.test(core)) return;
  if (/^INSERT\s/i.test(core)) return;
  if (/^UPDATE\s/i.test(core)) return;
  if (/^DELETE\s/i.test(core)) return;
  if (/^TRUNCATE\s/i.test(core)) return;
  if (/^ALTER\s+PUBLICATION/i.test(core)) return;

  const ct = parseCreateTable(core);
  if (ct) {
    const tbl = ensureTable(ct.table);
    for (const item of expandTableItems(ct.items)) {
      const cleaned = stripLineComments(item);
      if (!cleaned) continue;
      if (isConstraintItem(cleaned)) {
        const cm = cleaned.match(/^CONSTRAINT\s+(\w+)\s+/i);
        if (cm) tbl.constraints.set(cm[1], cleaned.replace(/^CONSTRAINT\s+\w+\s+/i, ''));
        else tbl.inlineChecks.push(cleaned);
      } else {
        const cn = colNameFromItem(cleaned);
        // Reject procedural leftovers / comment debris mistaken for columns.
        if (
          cn &&
          /^[a-z_][a-z0-9_]*$/i.test(cn) &&
          !/^(END|IF|THEN|ELSE|BEGIN|RETURN|SELECT|FROM|WHERE|AND|OR|WHEN|ELSEIF)$/i.test(
            cn,
          ) &&
          /\s/.test(cleaned)
        ) {
          tbl.columns.set(cn, cleaned);
        }
      }
    }
    return;
  }

  if (/^CREATE\s+TYPE\s/i.test(core)) {
    const m = core.match(
      /CREATE\s+TYPE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)\s+AS\s+ENUM\s*\(([^)]*)\)/i,
    );
    if (m) {
      state.types.set(
        m[1],
        `CREATE TYPE wacrm.${m[1]} AS ENUM (${m[2]});`,
      );
    }
    return;
  }

  const addCol = core.match(
    /^ALTER\s+TABLE\s+(?:ONLY\s+)?(?:public\.)?(\w+)\s+([\s\S]+)$/i,
  );
  if (addCol && /^ADD\s+COLUMN/i.test(addCol[2])) {
    const table = addCol[1];
    if (!APP_TABLES.has(table)) return;
    const body = addCol[2];
    const chunks = body.split(/,\s*ADD\s+COLUMN\s+/i).map((c, idx) =>
      idx === 0 ? c.replace(/^\s*ADD\s+COLUMN\s+/i, '') : c,
    );
    const tbl = ensureTable(table);
    for (const chunk of chunks) {
      const def = chunk.replace(/^IF\s+NOT\s+EXISTS\s+/i, '').trim();
      const cn = colNameFromItem(def);
      if (cn) tbl.columns.set(cn, def);
    }
    return;
  }

  if (/^ALTER\s+TABLE\s+(?:public\.)?(\w+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(core)) {
    const m = core.match(/^ALTER\s+TABLE\s+(?:public\.)?(\w+)/i);
    if (m && APP_TABLES.has(m[1])) state.rlsTables.add(m[1]);
    return;
  }

  const alterCol = core.match(
    /^ALTER\s+TABLE\s+(?:public\.)?(\w+)\s+ALTER\s+COLUMN\s+(\w+)\s+(.+)$/i,
  );
  if (alterCol && APP_TABLES.has(alterCol[1])) {
    const tbl = ensureTable(alterCol[1]);
    const col = alterCol[2];
    const action = alterCol[3].toUpperCase();
    const existing = tbl.columns.get(col);
    if (!existing) return;
    if (action.includes('DROP NOT NULL')) {
      tbl.columns.set(col, existing.replace(/\s+NOT\s+NULL/i, ''));
    } else if (action.includes('SET NOT NULL')) {
      if (!/\sNOT\s+NULL/i.test(existing)) tbl.columns.set(col, `${existing} NOT NULL`);
    } else if (action.includes('SET DEFAULT')) {
      const dm = alterCol[3].match(/SET\s+DEFAULT\s+(.+)$/i);
      if (dm) {
        let next = existing.replace(/\s+DEFAULT\s+[^,]+/i, '');
        tbl.columns.set(col, `${next} DEFAULT ${dm[1]}`);
      }
    }
    return;
  }

  const addConstr = core.match(
    /^ALTER\s+TABLE\s+(?:public\.)?(\w+)\s+ADD\s+CONSTRAINT\s+(\w+)\s+([\s\S]+)$/i,
  );
  if (addConstr && APP_TABLES.has(addConstr[1])) {
    ensureTable(addConstr[1]).constraints.set(addConstr[2], addConstr[3].replace(/;\s*$/, ''));
    return;
  }

  if (/^ALTER\s+TABLE\s+(?:public\.)?(\w+)\s+REPLICA\s+IDENTITY\s+(\w+)/i.test(core)) {
    const m = core.match(/^ALTER\s+TABLE\s+(?:public\.)?(\w+)\s+REPLICA\s+IDENTITY\s+(\w+)/i);
    if (m && APP_TABLES.has(m[1])) state.replicaIdentity.set(m[1], m[2]);
    return;
  }

  if (/^CREATE\s+(?:UNIQUE\s+)?INDEX/i.test(core)) {
    if (/ON\s+storage\./i.test(core)) return;
    let idx = core.replace(/\s+IF\s+NOT\s+EXISTS\s+/i, ' IF NOT EXISTS ');
    // Force ON wacrm.<table> for app tables.
    idx = idx.replace(
      /\bON\s+(?:public\.)?(\w+)\b/i,
      (match, tbl) => (APP_TABLES.has(tbl) ? `ON wacrm.${tbl}` : match),
    );
    const key = normalizeWs(idx);
    state.indexes.set(key, qualifyIdentifiers(idx));
    return;
  }

  if (/^CREATE\s+POLICY/i.test(core)) {
    const m = core.match(/CREATE\s+POLICY\s+("?[\w\s]+"?)\s+ON\s+(?:public\.)?(\w+)/i);
    if (m && APP_TABLES.has(m[2])) {
      const name = m[1].replace(/"/g, '');
      let pol = core.replace(
        /\bON\s+(?:public\.)?(\w+)\b/i,
        (match, tbl) => (APP_TABLES.has(tbl) ? `ON wacrm.${tbl}` : match),
      );
      state.policies.set(`${m[2]}:${name}`, qualifyIdentifiers(pol));
    }
    return;
  }

  if (/^CREATE\s+TRIGGER/i.test(core)) {
    if (/ON\s+auth\./i.test(core) || /ON\s+storage\./i.test(core) || /ON\s+public\./i.test(core)) {
      return;
    }
    const m = core.match(/ON\s+(?:public\.)?(\w+)/i);
    if (m && APP_TABLES.has(m[1])) {
      const tname = core.match(/CREATE\s+TRIGGER\s+(\w+)/i)?.[1] ?? core;
      state.triggers.set(tname, qualifyIdentifiers(core));
    }
    return;
  }

  if (/^CREATE\s+OR\s+REPLACE\s+FUNCTION/i.test(core)) {
    const fn = core.match(/FUNCTION\s+(?:public\.)?(\w+)/i)?.[1];
    if (fn && SKIP_FUNCTION_NAMES.has(fn)) return;
    const sig = core.match(/FUNCTION\s+([\s\S]+?)\s+RETURNS/i)?.[1] ?? fn;
    const key = normalizeWs(sig);
    state.functions.set(key, qualifyIdentifiers(core));
    return;
  }

  if (/^GRANT\s/i.test(core) && !/storage\./i.test(core)) {
    state.grants.push(qualifyIdentifiers(core));
    return;
  }
  if (/^REVOKE\s/i.test(core) && !/storage\./i.test(core)) {
    state.revokes.push(qualifyIdentifiers(core));
    return;
  }

  if (/^ALTER\s+FUNCTION/i.test(core) && !/handle_new_user/i.test(core)) {
    state.grants.push(qualifyIdentifiers(core));
  }
}

function buildEnsureChatProfile() {
  return `
CREATE OR REPLACE FUNCTION wacrm.ensure_chat_profile(p_full_name text DEFAULT '')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wacrm, extensions
AS $$
DECLARE
  v_uid uuid;
  v_email text;
  v_account_id uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  IF EXISTS (SELECT 1 FROM wacrm.profiles p WHERE p.user_id = v_uid) THEN
    RETURN;
  END IF;

  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid;

  INSERT INTO wacrm.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(trim(p_full_name), ''), v_email, 'My account'), v_uid)
  RETURNING id INTO v_account_id;

  INSERT INTO wacrm.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (
    v_uid,
    COALESCE(p_full_name, ''),
    COALESCE(v_email, ''),
    v_account_id,
    'owner'
  );
END;
$$;

ALTER FUNCTION wacrm.ensure_chat_profile(text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION wacrm.ensure_chat_profile(text) TO authenticated, service_role;
`;
}

function emitCreateTable(name, def) {
  const cols = [...def.columns.values()].map((c) => qualifyIdentifiers(c));
  const constr = [...def.constraints.entries()].map(([n, c]) => `CONSTRAINT ${n} ${qualifyIdentifiers(c)}`);
  const inline = def.inlineChecks.map((c) => qualifyIdentifiers(c));
  const all = [...cols, ...constr, ...inline];
  const replica = state.replicaIdentity.get(name);
  const replicaClause = replica ? ` REPLICA IDENTITY ${replica}` : '';
  return `CREATE TABLE wacrm.${name} (\n  ${all.join(',\n  ')}\n)${replicaClause};`;
}

function emitSchema() {
  const lines = [];
  lines.push('-- Astra Chat (wacrm) consolidated schema — CREATE only');
  lines.push('-- Generated by scripts/generate-wacrm-schema.mjs from migrations 001–058');
  lines.push('');
  lines.push('CREATE SCHEMA IF NOT EXISTS wacrm;');
  lines.push('');
  for (const ext of [...state.extensions].sort()) {
    lines.push(`CREATE EXTENSION IF NOT EXISTS "${ext}" WITH SCHEMA extensions;`);
  }
  lines.push('');
  lines.push('GRANT USAGE ON SCHEMA wacrm TO anon, authenticated, service_role;');
  lines.push('');

  if (!state.types.has('account_role_enum')) {
    state.types.set(
      'account_role_enum',
      "CREATE TYPE wacrm.account_role_enum AS ENUM ('owner', 'admin', 'agent', 'viewer');",
    );
  }
  for (const [, ddl] of state.types) {
    lines.push(ddl);
    lines.push('');
  }

  // Topological-ish order: accounts before dependents, profiles early,
  // then alphabetical within the rest so FKs to accounts/contacts resolve.
  const preferred = [
    'accounts',
    'profiles',
    'account_invitations',
    'contacts',
    'tags',
    'contact_tags',
    'custom_fields',
    'contact_custom_values',
    'contact_notes',
    'conversations',
    'messages',
    'message_reactions',
    'whatsapp_config',
    'message_templates',
    'pipelines',
    'pipeline_stages',
    'deals',
    'broadcasts',
    'broadcast_recipients',
    'automations',
    'automation_steps',
    'automation_logs',
    'automation_pending_executions',
    'flows',
    'flow_nodes',
    'flow_runs',
    'flow_run_events',
    'member_presence',
    'api_keys',
    'notifications',
    'webhook_endpoints',
    'ai_configs',
    'ai_knowledge_documents',
    'ai_knowledge_chunks',
    'ai_usage_log',
    'quick_replies',
    'consent_events',
    'astra_connect_handoff_audit',
    'astra_usage_daily',
    'integration_connections',
    'integration_event_log',
    'webhook_delivery_queue',
    'ecommerce_orders',
    'ecommerce_notify_queue',
    'product_catalog_items',
    'payment_links',
    'sheets_sync_runs',
    'crm_push_log',
    'ad_attributions',
    'intents',
    'intent_training_phrases',
    'intent_entities',
  ];
  const remaining = [...state.tables.keys()]
    .filter((n) => !preferred.includes(n))
    .sort();
  const tableOrder = [...preferred.filter((n) => state.tables.has(n)), ...remaining];
  for (const name of tableOrder) {
    lines.push(emitCreateTable(name, state.tables.get(name)));
    lines.push('');
  }

  for (const [, idx] of state.indexes) {
    if (!/CREATE\s+INDEX/i.test(idx)) continue;
    lines.push(idx.endsWith(';') ? idx : `${idx};`);
  }
  lines.push('');

  // RLS must be enabled post-create (no CREATE TABLE equivalent).
  for (const t of [...state.rlsTables].sort()) {
    lines.push(`ALTER TABLE wacrm.${t} ENABLE ROW LEVEL SECURITY;`);
  }
  lines.push('');

  for (const [, pol] of state.policies) {
    lines.push(pol.endsWith(';') ? pol : `${pol};`);
  }
  lines.push('');

  for (const [, fn] of state.functions) {
    lines.push(fn.endsWith(';') ? fn : `${fn};`);
    lines.push('');
  }

  lines.push(buildEnsureChatProfile());
  lines.push('');

  for (const [, trg] of state.triggers) {
    lines.push(trg.endsWith(';') ? trg : `${trg};`);
  }
  lines.push('');

  const grantSet = new Set(state.revokes.concat(state.grants));
  for (const g of grantSet) {
    lines.push(g.endsWith(';') ? g : `${g};`);
  }
  lines.push('');
  lines.push('GRANT ALL ON ALL TABLES IN SCHEMA wacrm TO authenticated, service_role;');
  lines.push('GRANT ALL ON ALL SEQUENCES IN SCHEMA wacrm TO authenticated, service_role;');
  lines.push('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA wacrm TO authenticated, service_role;');

  return lines.join('\n');
}

export { splitStatements, splitTableItems, parseCreateTable };

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const file of listMigrations()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of splitStatements(sql)) {
      processStatement(stmt);
    }
  }
  const out = emitSchema();
  fs.writeFileSync(OUT_FILE, out, 'utf8');
  console.log(`Wrote ${OUT_FILE} (${out.split('\n').length} lines)`);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main();
}
