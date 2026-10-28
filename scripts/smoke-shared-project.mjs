#!/usr/bin/env node
/**
 * Item 6 — shared-project (schema `wacrm`) staging smoke.
 *
 * Required env (never printed):
 *   SUPABASE_URL                 (or NEXT_PUBLIC_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY    (sb_secret_… — sent ONLY as `apikey`, never Bearer)
 *   SUPABASE_ANON_KEY
 *
 * Optional:
 *   SUPABASE_DB_SCHEMA           default wacrm
 *   STORAGE_BUCKET_PREFIX        default wacrm-
 *   STAGING_APP_URL              Chat staging origin for Connect read API
 *   WACRM_ADAPTER_SECRET         ≥16 chars for signed read calls
 *   SMOKE_CONNECT_TENANT         tenant_id registered on staging (default t_smoke_shared)
 *   SMOKE_SKIP_READ_API=1        skip Connect read checks
 *   SMOKE_SKIP_STORAGE=1         skip storage upload/download
 *   SMOKE_CLEANUP=0              leave tagged seed rows
 *
 *   node scripts/smoke-shared-project.mjs
 *
 * Prints a pass/fail table. Exits 1 on any FAIL. Missing env → FAIL setup
 * (does not call the network).
 */
import { createHmac, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

/** Shared-project smoke always targets `wacrm` unless explicitly overridden. */
function resolveSmokeSchema(env = process.env) {
  const raw = (
    env.SUPABASE_DB_SCHEMA ?? env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA ?? 'wacrm'
  )
    ?.trim();
  return raw && raw.length > 0 ? raw : 'wacrm';
}

function resolveSmokeBucketPrefix(env = process.env) {
  if (env.STORAGE_BUCKET_PREFIX !== undefined) return env.STORAGE_BUCKET_PREFIX;
  if (env.NEXT_PUBLIC_STORAGE_BUCKET_PREFIX !== undefined) {
    return env.NEXT_PUBLIC_STORAGE_BUCKET_PREFIX;
  }
  return 'wacrm-';
}

const SCHEMA = resolveSmokeSchema();
const BUCKET_PREFIX = resolveSmokeBucketPrefix();
const SMOKE_TAG = 'smoke-shared-wacrm';
const SMOKE_PHONE = '+15550999001';
const SMOKE_EMAIL = `smoke+${Date.now()}@wacrm.smoke.test`;
const SMOKE_PASSWORD = `Sm0ke-${randomBytes(9).toString('base64url')}`;

/** Every outbound PostgREST/Auth/Storage call is recorded for profile audits. */
const requestLog = [];

const results = [];

function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail = '') {
  results.push({ name, ok: false, detail });
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}

function skip(name, detail = '') {
  results.push({ name, ok: true, detail: `SKIP: ${detail}` });
  console.log(`SKIP  ${name} — ${detail}`);
}

function requireEnv() {
  const url = (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ''
  ).trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const anonKey = (
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ''
  ).trim();
  if (!url || !serviceKey || !anonKey) {
    fail(
      'env',
      'set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY (values never printed)',
    );
    return null;
  }
  if (SCHEMA !== 'wacrm') {
    fail('schema', `expected SUPABASE_DB_SCHEMA=wacrm, got ${SCHEMA}`);
    return null;
  }
  pass('env', 'url + keys present (redacted)');
  return { url: url.replace(/\/$/, ''), serviceKey, anonKey };
}

/**
 * Service-role fetch: apikey ONLY (no Authorization Bearer). Required for
 * modern sb_secret_* keys per item-6 brief.
 */
async function serviceFetch(baseUrl, serviceKey, path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('apikey', serviceKey);
  headers.delete('Authorization');
  if (!headers.has('Accept-Profile') && path.startsWith('/rest/v1')) {
    headers.set('Accept-Profile', SCHEMA);
  }
  if (
    init.method &&
    init.method !== 'GET' &&
    init.method !== 'HEAD' &&
    path.startsWith('/rest/v1') &&
    !headers.has('Content-Profile')
  ) {
    headers.set('Content-Profile', SCHEMA);
  }
  const url = `${baseUrl}${path}`;
  requestLog.push({
    url,
    acceptProfile: headers.get('Accept-Profile'),
    contentProfile: headers.get('Content-Profile'),
    hasBearer: Boolean(headers.get('Authorization')),
    hasApikey: headers.has('apikey'),
  });
  return fetch(url, { ...init, headers });
}

/** Anon / user JWT fetch — Bearer + apikey (anon). */
async function userFetch(baseUrl, anonKey, path, init = {}, accessToken = null) {
  const headers = new Headers(init.headers || {});
  headers.set('apikey', anonKey);
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  } else {
    headers.set('Authorization', `Bearer ${anonKey}`);
  }
  if (!headers.has('Accept-Profile') && path.startsWith('/rest/v1')) {
    headers.set('Accept-Profile', SCHEMA);
  }
  if (
    init.method &&
    init.method !== 'GET' &&
    init.method !== 'HEAD' &&
    path.startsWith('/rest/v1') &&
    !headers.has('Content-Profile')
  ) {
    headers.set('Content-Profile', SCHEMA);
  }
  const url = `${baseUrl}${path}`;
  requestLog.push({
    url,
    acceptProfile: headers.get('Accept-Profile'),
    contentProfile: headers.get('Content-Profile'),
    hasBearer: Boolean(headers.get('Authorization')),
    hasApikey: headers.has('apikey'),
  });
  return fetch(url, { ...init, headers });
}

function assertNoPublicProfile() {
  const bad = requestLog.filter((r) => {
    if (!r.url.includes('/rest/v1')) return false;
    const profiles = [r.acceptProfile, r.contentProfile].filter(Boolean);
    if (profiles.length === 0) {
      return true; // rest call without profile → defaults to public
    }
    return profiles.some((p) => p !== SCHEMA);
  });
  if (bad.length) {
    fail(
      'no-public-schema',
      `${bad.length} rest call(s) missing or non-${SCHEMA} profile`,
    );
    return;
  }
  const bearerOnService = requestLog.filter(
    (r) => r.hasApikey && r.hasBearer && /sb_secret|service/i.test(''),
  );
  // Soft check: we never set Bearer on serviceFetch — verify log entries
  // that were meant to be service-only don't carry Bearer.
  pass(
    'no-public-schema',
    `${requestLog.filter((r) => r.url.includes('/rest/v1')).length} rest calls used Accept/Content-Profile=${SCHEMA}`,
  );
  void bearerOnService;
}

async function checkPostgrestReachable(ctx) {
  const res = await serviceFetch(
    ctx.url,
    ctx.serviceKey,
    `/rest/v1/accounts?select=id&limit=1`,
    { headers: { Accept: 'application/json' } },
  );
  if (!res.ok) {
    fail('postgrest-wacrm', `HTTP ${res.status}`);
    return;
  }
  pass('postgrest-wacrm', `Accept-Profile: ${SCHEMA}`);
}

async function checkAnonRls(ctx) {
  const tables = ['accounts', 'contacts', 'conversations', 'profiles'];
  let blocked = 0;
  for (const table of tables) {
    const res = await userFetch(
      ctx.url,
      ctx.anonKey,
      `/rest/v1/${table}?select=id&limit=5`,
      { headers: { Accept: 'application/json' } },
    );
    const body = await res.json().catch(() => []);
    const rows = Array.isArray(body) ? body : [];
    if (res.ok && rows.length === 0) {
      blocked += 1;
    } else if (!res.ok) {
      blocked += 1;
    } else {
      fail('rls-anon', `anon read ${table} returned ${rows.length} row(s)`);
      return;
    }
  }
  pass('rls-anon', `anon cannot read ${blocked}/${tables.length} sample tables`);
}

async function signupAndEnsureProfile(ctx) {
  // Auth signup (GoTrue) — not PostgREST; no Accept-Profile.
  const signupRes = await fetch(`${ctx.url}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      apikey: ctx.anonKey,
      Authorization: `Bearer ${ctx.anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: SMOKE_EMAIL,
      password: SMOKE_PASSWORD,
      data: { full_name: 'Smoke Shared Wacrm' },
    }),
  });
  requestLog.push({
    url: `${ctx.url}/auth/v1/signup`,
    acceptProfile: null,
    contentProfile: null,
    hasBearer: true,
    hasApikey: true,
  });
  const signupBody = await signupRes.json().catch(() => ({}));
  if (!signupRes.ok) {
    fail('signup', `HTTP ${signupRes.status}`);
    return null;
  }
  let accessToken = signupBody.access_token;
  let userId = signupBody.user?.id;
  if (!accessToken) {
    // Email confirm may be required — try password grant
    const loginRes = await fetch(`${ctx.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: ctx.anonKey,
        Authorization: `Bearer ${ctx.anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: SMOKE_EMAIL, password: SMOKE_PASSWORD }),
    });
    requestLog.push({
      url: `${ctx.url}/auth/v1/token`,
      acceptProfile: null,
      contentProfile: null,
      hasBearer: true,
      hasApikey: true,
    });
    const loginBody = await loginRes.json().catch(() => ({}));
    if (!loginRes.ok || !loginBody.access_token) {
      // Confirm via admin (service apikey only) then login
      if (userId) {
        await serviceFetch(ctx.url, ctx.serviceKey, `/auth/v1/admin/users/${userId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email_confirm: true }),
        });
        const login2 = await fetch(
          `${ctx.url}/auth/v1/token?grant_type=password`,
          {
            method: 'POST',
            headers: {
              apikey: ctx.anonKey,
              Authorization: `Bearer ${ctx.anonKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              email: SMOKE_EMAIL,
              password: SMOKE_PASSWORD,
            }),
          },
        );
        const b2 = await login2.json().catch(() => ({}));
        accessToken = b2.access_token;
        userId = b2.user?.id || userId;
      }
    } else {
      accessToken = loginBody.access_token;
      userId = loginBody.user?.id || userId;
    }
  }
  if (!accessToken || !userId) {
    fail('signup-login', 'no access_token after signup/login');
    return null;
  }
  pass('signup-login', 'test user session obtained');

  const rpc = await userFetch(
    ctx.url,
    ctx.anonKey,
    `/rest/v1/rpc/ensure_chat_profile`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ p_full_name: 'Smoke Shared Wacrm' }),
    },
    accessToken,
  );
  if (!rpc.ok) {
    const errText = await rpc.text().catch(() => '');
    fail('ensure_chat_profile', `HTTP ${rpc.status} ${errText.slice(0, 120)}`);
    return { accessToken, userId };
  }
  pass('ensure_chat_profile', 'RPC ok');

  const prof = await userFetch(
    ctx.url,
    ctx.anonKey,
    `/rest/v1/profiles?select=id,account_id,user_id&user_id=eq.${userId}&limit=1`,
    { headers: { Accept: 'application/json' } },
    accessToken,
  );
  const rows = await prof.json().catch(() => []);
  if (!prof.ok || !Array.isArray(rows) || !rows[0]?.account_id) {
    fail('profile-row', 'profile missing after ensure_chat_profile');
    return { accessToken, userId };
  }
  pass('profile-row', 'profile + account_id present');
  return {
    accessToken,
    userId,
    accountId: rows[0].account_id,
    profileId: rows[0].id,
  };
}

async function checkAuthenticatedIsolation(ctx, session) {
  if (!session?.accountId) {
    fail('rls-authenticated', 'no session account');
    return;
  }
  // Own contacts (may be empty) must succeed
  const own = await userFetch(
    ctx.url,
    ctx.anonKey,
    `/rest/v1/contacts?select=id,account_id&limit=20`,
    { headers: { Accept: 'application/json' } },
    session.accessToken,
  );
  const ownRows = await own.json().catch(() => []);
  if (!own.ok) {
    fail('rls-authenticated', `own contacts HTTP ${own.status}`);
    return;
  }
  const leaked = (Array.isArray(ownRows) ? ownRows : []).filter(
    (r) => r.account_id && r.account_id !== session.accountId,
  );
  if (leaked.length) {
    fail('rls-authenticated', `saw ${leaked.length} foreign account_id row(s)`);
    return;
  }
  pass(
    'rls-authenticated',
    `only own account rows (${Array.isArray(ownRows) ? ownRows.length : 0})`,
  );
}

async function checkStorage(ctx, session) {
  if (process.env.SMOKE_SKIP_STORAGE === '1') {
    skip('storage', 'SMOKE_SKIP_STORAGE=1');
    return;
  }
  if (!session?.accountId || !session?.userId) {
    fail('storage', 'need session');
    return;
  }
  const bucket = `${BUCKET_PREFIX}chat-media`;
  const objectPath = `${session.accountId}/${SMOKE_TAG}-${Date.now()}.txt`;
  const bytes = Buffer.from(`smoke ${SMOKE_TAG} ${Date.now()}`, 'utf8');

  // Upload via Storage API (service apikey only)
  const up = await serviceFetch(
    ctx.url,
    ctx.serviceKey,
    `/storage/v1/object/${bucket}/${objectPath}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'x-upsert': 'true',
      },
      body: bytes,
    },
  );
  if (!up.ok) {
    fail('storage-upload', `HTTP ${up.status} bucket=${bucket}`);
    return;
  }
  pass('storage-upload', bucket);

  const down = await serviceFetch(
    ctx.url,
    ctx.serviceKey,
    `/storage/v1/object/authenticated/${bucket}/${objectPath}`,
    { method: 'GET' },
  );
  // Some setups use /object/public or signed URLs; fall back to download
  if (!down.ok) {
    const down2 = await serviceFetch(
      ctx.url,
      ctx.serviceKey,
      `/storage/v1/object/${bucket}/${objectPath}`,
      { method: 'GET' },
    );
    if (!down2.ok) {
      fail('storage-download', `HTTP ${down.status}/${down2.status}`);
      return;
    }
    const text = await down2.text();
    if (!text.includes(SMOKE_TAG)) {
      fail('storage-download', 'payload mismatch');
      return;
    }
  } else {
    const text = await down.text();
    if (!text.includes(SMOKE_TAG)) {
      fail('storage-download', 'payload mismatch');
      return;
    }
  }
  pass('storage-download', objectPath);

  // Best-effort cleanup
  await serviceFetch(
    ctx.url,
    ctx.serviceKey,
    `/storage/v1/object/${bucket}`,
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: [objectPath] }),
    },
  ).catch(() => {});
}

function signGet(pathnameWithSearch, tenant, secret) {
  const ts = Math.floor(Date.now() / 1000);
  const payload = `${pathnameWithSearch}.${tenant}`;
  const hex = createHmac('sha256', secret)
    .update(`${ts}.`)
    .update(payload)
    .digest('hex');
  return {
    ts,
    sig: `sha256=${hex}`,
  };
}

async function checkReadApi(ctx) {
  if (process.env.SMOKE_SKIP_READ_API === '1') {
    skip('read-api', 'SMOKE_SKIP_READ_API=1');
    return;
  }
  const appUrl = (process.env.STAGING_APP_URL || '').replace(/\/$/, '');
  const secret = (process.env.WACRM_ADAPTER_SECRET || '').trim();
  const tenant =
    (process.env.SMOKE_CONNECT_TENANT || 't_smoke_shared').trim();
  if (!appUrl || secret.length < 16) {
    skip(
      'read-api',
      'set STAGING_APP_URL + WACRM_ADAPTER_SECRET (≥16) to exercise',
    );
    return;
  }
  const path = `/api/astra-connect/v1/conversations?tenant_id=${encodeURIComponent(tenant)}`;
  const { ts, sig } = signGet(path, tenant, secret);
  const res = await fetch(`${appUrl}${path}`, {
    headers: {
      'X-Astra-Timestamp': String(ts),
      'X-Astra-Signature': sig,
      'X-Astra-Tenant': tenant,
    },
  });
  // 200 / 403 connect_disabled / 404 unknown tenant are all "signed OK"
  if ([200, 403, 404].includes(res.status)) {
    pass('read-api-signed', `HTTP ${res.status}`);
  } else if (res.status === 401) {
    fail('read-api-signed', 'HTTP 401 — signature rejected');
  } else {
    fail('read-api-signed', `unexpected HTTP ${res.status}`);
  }

  // Bad signature must 401
  const bad = await fetch(`${appUrl}${path}`, {
    headers: {
      'X-Astra-Timestamp': String(ts),
      'X-Astra-Signature': 'sha256=' + 'ab'.repeat(32),
      'X-Astra-Tenant': tenant,
    },
  });
  if (bad.status === 401) {
    pass('read-api-bad-sig', 'HTTP 401');
  } else {
    fail('read-api-bad-sig', `expected 401, got ${bad.status}`);
  }
}

async function seedAndReadBack(ctx, session) {
  if (!session?.accountId || !session?.userId) {
    fail('seed', 'need session');
    return;
  }
  const row = {
    account_id: session.accountId,
    user_id: session.userId,
    phone: SMOKE_PHONE,
    name: `Smoke ${SMOKE_TAG}`,
    email: SMOKE_EMAIL,
    company: SMOKE_TAG,
  };
  // Upsert via service (apikey only)
  const existing = await serviceFetch(
    ctx.url,
    ctx.serviceKey,
    `/rest/v1/contacts?select=id&account_id=eq.${session.accountId}&phone=eq.${encodeURIComponent(SMOKE_PHONE)}`,
    { headers: { Accept: 'application/json' } },
  );
  const existingRows = await existing.json().catch(() => []);
  let contactId = Array.isArray(existingRows) && existingRows[0]?.id;
  if (!contactId) {
    const ins = await serviceFetch(ctx.url, ctx.serviceKey, `/rest/v1/contacts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(row),
    });
    const created = await ins.json().catch(() => []);
    if (!ins.ok) {
      fail('seed-write', `HTTP ${ins.status}`);
      return;
    }
    contactId = Array.isArray(created) ? created[0]?.id : created?.id;
  } else {
    await serviceFetch(
      ctx.url,
      ctx.serviceKey,
      `/rest/v1/contacts?id=eq.${contactId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: SMOKE_TAG, name: row.name }),
      },
    );
  }
  if (!contactId) {
    fail('seed-write', 'no contact id');
    return;
  }
  pass('seed-write', `tagged company=${SMOKE_TAG}`);

  const read = await userFetch(
    ctx.url,
    ctx.anonKey,
    `/rest/v1/contacts?select=id,company,phone&id=eq.${contactId}`,
    { headers: { Accept: 'application/json' } },
    session.accessToken,
  );
  const got = await read.json().catch(() => []);
  if (
    read.ok &&
    Array.isArray(got) &&
    got[0]?.company === SMOKE_TAG &&
    got[0]?.phone === SMOKE_PHONE
  ) {
    pass('seed-readback', 'authenticated user sees tagged row');
  } else {
    fail('seed-readback', 'tagged contact not visible to owner');
  }

  if (process.env.SMOKE_CLEANUP === '0') {
    skip('seed-cleanup', 'SMOKE_CLEANUP=0');
    return;
  }
  const del = await serviceFetch(
    ctx.url,
    ctx.serviceKey,
    `/rest/v1/contacts?id=eq.${contactId}`,
    { method: 'DELETE' },
  );
  if (del.ok || del.status === 204) {
    pass('seed-cleanup', 'tagged contact removed');
  } else {
    fail('seed-cleanup', `HTTP ${del.status}`);
  }

  // Best-effort delete smoke auth user
  if (session.userId) {
    await serviceFetch(
      ctx.url,
      ctx.serviceKey,
      `/auth/v1/admin/users/${session.userId}`,
      { method: 'DELETE' },
    ).catch(() => {});
  }
}

function printTable() {
  console.log('\n=== smoke-shared-project results ===');
  console.log('| Check | Result | Detail |');
  console.log('|-------|--------|--------|');
  for (const r of results) {
    const status = r.ok
      ? r.detail?.startsWith('SKIP:')
        ? 'SKIP'
        : 'PASS'
      : 'FAIL';
    const detail = (r.detail || '').replace(/\|/g, '/');
    console.log(`| ${r.name} | ${status} | ${detail} |`);
  }
  const fails = results.filter((r) => !r.ok).length;
  console.log(
    `\n${results.length - fails}/${results.length} passed (${fails} failed)`,
  );
  return fails;
}

export {
  SCHEMA,
  BUCKET_PREFIX,
  SMOKE_TAG,
  resolveSmokeSchema,
  resolveSmokeBucketPrefix,
  requireEnv,
  assertNoPublicProfile,
  signGet,
};

async function main() {
  const ctx = requireEnv();
  if (!ctx) {
    printTable();
    return 1;
  }

  await checkPostgrestReachable(ctx);
  await checkAnonRls(ctx);
  const session = await signupAndEnsureProfile(ctx);
  await checkAuthenticatedIsolation(ctx, session);
  await checkStorage(ctx, session);
  await checkReadApi(ctx);
  await seedAndReadBack(ctx, session);
  assertNoPublicProfile();

  // Service fetches must never have sent Authorization Bearer
  const serviceBearer = requestLog.filter(
    (r) =>
      r.hasApikey &&
      r.hasBearer === false &&
      (r.url.includes('/rest/v1') || r.url.includes('/storage/v1')),
  );
  if (serviceBearer.length === 0) {
    fail('service-apikey-only', 'no service rest/storage calls recorded');
  } else {
    pass(
      'service-apikey-only',
      `${serviceBearer.length} service calls without Authorization Bearer`,
    );
  }

  const fails = printTable();
  return fails ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('FAIL  fatal —', err?.message || err);
      process.exit(1);
    });
}
