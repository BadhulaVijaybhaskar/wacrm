#!/usr/bin/env node
/**
 * CHAT-27 golden-rule E2E — everything selectable must work end-to-end.
 *
 * Requires a production server with:
 *   META_STUB=1 INTEGRATIONS_STUB=1 WHATSAPP_TEMPLATES_DRY_RUN=1
 *   (and local Supabase + demo@astraconnect.io)
 *
 *   NODE_ENV=production npm run build
 *   META_STUB=1 INTEGRATIONS_STUB=1 WHATSAPP_TEMPLATES_DRY_RUN=1 \
 *     NODE_ENV=production npm run start -- -p 3000 -H 127.0.0.1
 *   node scripts/chat-27-e2e.mjs
 *
 * Writes screenshots to artifacts/chat-27/ and a JSON report.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.SHOT_BASE_URL ?? 'http://127.0.0.1:3000';
const EMAIL = process.env.SHOT_EMAIL ?? 'demo@astraconnect.io';
const PASS = process.env.SHOT_PASSWORD ?? 'demo-password-123';
const OUT = join(process.cwd(), 'artifacts/chat-27');
mkdirSync(OUT, { recursive: true });

const NAV = [
  ['/dashboard', 'dashboard'],
  ['/inbox', 'inbox'],
  ['/notifications', 'notifications'],
  ['/contacts', 'contacts'],
  ['/pipelines', 'pipelines'],
  ['/broadcasts', 'broadcasts'],
  ['/ads', 'ads'],
  ['/automations', 'automations'],
  ['/flows', 'flows'],
  ['/agents', 'agents'],
  ['/settings', 'settings'],
];

const SETTINGS_TABS = [
  'overview',
  'profile',
  'security',
  'appearance',
  'whatsapp',
  'astra-connect',
  'templates',
  'quick-replies',
  'fields',
  'deals',
  'members',
  'api',
  'integrations',
];

/** Stub credentials per catalog provider (required fields only). */
const INTEGRATION_FIELDS = {
  outbound_webhooks: { default_url: 'https://example.com/hook' },
  zapier: { hook_url: 'https://hooks.zapier.com/hooks/catch/000/aaa' },
  make: { hook_url: 'https://hook.eu1.make.com/abcdef' },
  shopify: { shop_domain: 'demo.myshopify.com', webhook_secret: 'whsec_demo' },
  woocommerce: {
    store_url: 'https://shop.example.com',
    webhook_secret: 'whsec_demo',
  },
  razorpay: { key_id: 'rzp_test_xxx', key_secret: 'secret_xxx' },
  stripe: { secret_key: 'sk_test_xxx' },
  google_sheets: {
    client_id: 'google-client',
    client_secret: 'google-secret',
  },
  hubspot: { access_token: 'pat-xxx' },
  zoho: {
    client_id: 'zoho-client',
    client_secret: 'zoho-secret',
    refresh_token: 'zoho-refresh',
  },
  astra_crm: {
    webhook_url: 'https://crm.example.com/hook',
    signing_secret: 'sign_xxx',
  },
  instagram: { page_id: '111', page_access_token: 'ig_token' },
  messenger: { page_id: '222', page_access_token: 'ms_token' },
};

const report = {
  areas: {},
  failures: [],
  screenshots: [],
  consoleErrors: [],
  networkErrors: [],
};

function area(name) {
  if (!report.areas[name]) {
    report.areas[name] = { pass: true, notes: [] };
  }
  return report.areas[name];
}

function fail(name, msg) {
  const a = area(name);
  a.pass = false;
  a.notes.push(msg);
  report.failures.push(`[${name}] ${msg}`);
  console.error('FAIL', name, msg);
}

function note(name, msg) {
  area(name).notes.push(msg);
  console.log('OK', name, msg);
}

async function shot(page, name) {
  const file = `${name}.png`;
  await page.screenshot({
    path: join(OUT, file),
    animations: 'disabled',
    fullPage: false,
  });
  report.screenshots.push(`artifacts/chat-27/${file}`);
  console.log('shot', file);
}

async function assertNoDeadUi(page, label) {
  const text = (await page.locator('body').innerText().catch(() => '')) || '';
  if (/coming soon/i.test(text)) {
    fail(label, 'page contains "coming soon"');
  }
  if (/not implemented/i.test(text)) {
    fail(label, 'page contains "not implemented"');
  }
  // Next.js not-found / error
  if (/this page could not be found/i.test(text)) {
    fail(label, '404 page');
  }
  if (/application error/i.test(text)) {
    fail(label, 'application error');
  }
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'load' });
  await page.fill('input#email, input[type=email]', EMAIL);
  await page.fill('input#password, input[type=password]', PASS);
  await Promise.all([
    page.waitForURL(/\/(dashboard|inbox)/, { timeout: 45000 }).catch(() => {}),
    page.click('button[type=submit]'),
  ]);
  await page.waitForTimeout(1500);
  if (/\/login/.test(page.url())) {
    fail('auth', `still on login after submit: ${page.url()}`);
    throw new Error('login failed');
  }
  note('auth', `signed in as ${EMAIL}`);
  await shot(page, '01-login-success');
}

async function clickNav(page, href, key) {
  const link = page.locator(`a[href="${href}"]`).first();
  if ((await link.count()) === 0) {
    fail('nav', `missing sidebar link ${href}`);
    return;
  }
  await link.click();
  await page.waitForTimeout(800);
  await page.waitForLoadState('domcontentloaded');
  if (!page.url().includes(href.split('?')[0])) {
    // soft: some redirects ok
    note('nav', `${key}: landed ${page.url()}`);
  } else {
    note('nav', `${key} ok`);
  }
  await assertNoDeadUi(page, `nav:${key}`);
  await shot(page, `nav-${key}`);
}

async function exerciseInbox(page) {
  const name = 'inbox';
  await page.goto(`${BASE}/inbox`, { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  await assertNoDeadUi(page, name);

  // Open first conversation if any
  const row = page.locator('[class*="conversation"], button').filter({
    hasText: /Priya|Jordan|Amelia|\+\d/,
  }).first();
  if (await row.count()) {
    await row.click().catch(() => {});
    await page.waitForTimeout(800);
  }

  // Assign dropdown if present
  const assign = page.getByRole('button', { name: /assign/i }).first();
  if (await assign.count()) {
    await assign.click();
    await page.waitForTimeout(400);
    const opt = page.getByRole('menuitem').first();
    if (await opt.count()) {
      await opt.click().catch(() => {});
      note(name, 'assign menu exercised');
    } else {
      await page.keyboard.press('Escape');
      note(name, 'assign opened (no menuitem)');
    }
  }

  // Take over / Resume AI if banner present
  const takeover = page.getByRole('button', {
    name: /take over|resume ai/i,
  }).first();
  if (await takeover.count()) {
    await takeover.click();
    await page.waitForTimeout(800);
    note(name, 'takeover/resume clicked');
  } else {
    note(name, 'no AI takeover banner (ok)');
  }

  // Add a note
  const noteBox = page.getByPlaceholder(/add a note|write a note/i).first();
  if (await noteBox.count()) {
    await noteBox.fill(`CHAT-27 e2e note ${Date.now()}`);
    const addNote = page.getByRole('button', { name: /add note|save note|^add$/i }).first();
    if (await addNote.count()) {
      await addNote.click();
      await page.waitForTimeout(600);
      note(name, 'note added');
    }
  }

  // Send a message
  const composer = page.getByPlaceholder(/type a message/i).first();
  if (await composer.count()) {
    const enabled = await composer.isEnabled();
    if (enabled) {
      await composer.fill(`CHAT-27 stub ping ${Date.now()}`);
      const send = page.getByRole('button', { name: /^send$/i }).first();
      if (await send.count()) {
        await send.click();
        await page.waitForTimeout(1000);
        note(name, 'send clicked');
      } else {
        // Enter to send
        await composer.press('Enter');
        await page.waitForTimeout(1000);
        note(name, 'send via Enter');
      }
    } else {
      note(name, 'composer disabled (window/read-only) — not a dead control');
    }
  } else {
    fail(name, 'composer not found');
  }

  await shot(page, 'inbox-thread');
}

async function dismissOverlays(page) {
  for (let i = 0; i < 3; i++) {
    const overlay = page.locator('[data-slot="dialog-overlay"][data-open]');
    if (!(await overlay.count())) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  // Click cancel/close if a dialog is still up
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible().catch(() => false)) {
    const cancel = dialog.getByRole('button', { name: /cancel|close|done/i }).first();
    if (await cancel.count()) await cancel.click().catch(() => {});
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
}

async function exerciseContacts(page) {
  const name = 'contacts';
  await page.goto(`${BASE}/contacts`, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await assertNoDeadUi(page, name);

  const add = page.getByRole('button', { name: /add contact/i }).first();
  if (!(await add.count())) {
    fail(name, 'Add Contact button missing');
    return;
  }
  await add.click();
  await page.waitForTimeout(500);
  const dialog = page.getByRole('dialog');
  const phone = dialog.locator('input[name="phone"], input#phone, input[type="tel"]').first();
  const cname = dialog.locator('input[name="name"], input#name, input#full_name, input[name="full_name"]').first();
  const stamp = Date.now().toString().slice(-8);
  if (await phone.count()) await phone.fill(`+15559${stamp.slice(0, 6)}`);
  else {
    // Fallback: any tel/text in dialog
    const any = dialog.locator('input').nth(0);
    if (await any.count()) await any.fill(`+15559${stamp.slice(0, 6)}`);
  }
  if (await cname.count()) await cname.fill(`E2E Contact ${stamp}`);
  const save = dialog.getByRole('button', { name: /save|create|add contact/i }).last();
  if (await save.count()) {
    await save.click();
    await page.waitForTimeout(1200);
    note(name, 'create contact submitted');
  }
  await dismissOverlays(page);
  await shot(page, 'contacts-create');

  // Import modal open/close
  const imp = page.getByRole('button', { name: /import/i }).first();
  if (await imp.count()) {
    await imp.click();
    await page.waitForTimeout(500);
    await assertNoDeadUi(page, `${name}:import`);
    await shot(page, 'contacts-import');
    await dismissOverlays(page);
    note(name, 'import dialog opened');
  }

  // Edit: open a contact row in the main list (not sidebar nav).
  const row = page.locator('main table tbody tr, main [data-contact-id]').first();
  if (await row.count()) {
    await row.click();
    await page.waitForTimeout(800);
    await shot(page, 'contacts-edit');
    note(name, 'contact detail opened');
  } else {
    note(name, 'no contact row to edit (list may be card-based)');
    // Try clicking a contact name in main
    const card = page.locator('main').getByText(/E2E Contact|Priya|Jordan/).first();
    if (await card.count()) {
      await card.click();
      await page.waitForTimeout(800);
      await shot(page, 'contacts-edit');
      note(name, 'contact opened via name');
    }
  }
}

async function exerciseBroadcasts(page) {
  const name = 'broadcasts';
  await page.goto(`${BASE}/broadcasts`, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await assertNoDeadUi(page, name);
  await shot(page, 'broadcasts-list');

  const create = page.getByRole('link', { name: /new broadcast/i }).first();
  const createBtn = page.getByRole('button', { name: /new broadcast/i }).first();
  if (await create.count()) {
    await create.click();
  } else if (await createBtn.count()) {
    await createBtn.click();
  } else {
    fail(name, 'New Broadcast control missing');
    return;
  }
  await page.waitForTimeout(1000);
  await assertNoDeadUi(page, `${name}:new`);
  await shot(page, 'broadcasts-new');

  // Try to advance wizard if template picker exists
  const tmpl = page.locator('button, [role="option"], [role="radio"]').filter({
    hasText: /welcome|template|\w+_/,
  }).first();
  if (await tmpl.count()) {
    await tmpl.click().catch(() => {});
    await page.waitForTimeout(400);
  }
  const next = page.getByRole('button', { name: /next|continue/i }).first();
  if (await next.count() && (await next.isEnabled())) {
    await next.click();
    await page.waitForTimeout(600);
    note(name, 'wizard advanced');
  }

  // Schedule / send step — look for Save draft or Send
  const draft = page.getByRole('button', { name: /save draft/i }).first();
  const send = page.getByRole('button', { name: /send broadcast|schedule/i }).first();
  if (await draft.count()) {
    note(name, 'save draft control present');
  }
  if (await send.count()) {
    note(name, 'send/schedule control present');
  }
  await shot(page, 'broadcasts-wizard');
}

async function exerciseFlows(page) {
  const name = 'flows';
  await page.goto(`${BASE}/flows`, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await assertNoDeadUi(page, name);
  await shot(page, 'flows-list');

  // Prefer opening an existing flow card; otherwise create from a template
  // (blank create requires a name — templates need one click).
  const existingCard = page.locator('[href^="/flows/"], button, a').filter({
    has: page.locator('text=/draft|active|paused/i'),
  }).first();
  const flowCards = page.locator('a[href^="/flows/"]').first();
  const neu = page.getByRole('button', { name: /new flow|create your first flow/i }).first();

  // If list already has flows, open the first editable card via its Edit/title click.
  const editBtn = page.getByRole('button', { name: /^edit$/i }).first();
  if (await editBtn.count()) {
    await editBtn.click();
  } else if (await flowCards.count()) {
    await flowCards.click();
  } else if (await neu.count()) {
    await neu.click();
    await page.waitForTimeout(600);
    const dialog = page.getByRole('dialog');
    // Template tiles are <button>s with the template name as accessible text.
    const tpl = dialog.getByRole('button').filter({ hasText: /Welcome menu|FAQ bot|Lead capture/i }).first();
    if (await tpl.count()) {
      await tpl.click();
      note(name, 'created flow from template');
    } else {
      const nameInput = dialog.locator('input').first();
      if (await nameInput.count()) {
        await nameInput.fill(`CHAT-27 flow ${Date.now()}`);
        const createBlank = dialog.getByRole('button', { name: /create blank flow/i });
        await createBlank.click();
        note(name, 'created blank flow');
      } else {
        fail(name, 'new-flow dialog missing template or name field');
        return;
      }
    }
  } else if (await existingCard.count()) {
    await existingCard.click();
  } else {
    fail(name, 'no New flow or existing flow');
    return;
  }

  await page.waitForURL(/\/flows\/[0-9a-f-]+/i, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  if (!/\/flows\/[^/]+/.test(page.url())) {
    fail(name, `did not reach flow editor (url=${page.url()})`);
    return;
  }
  note(name, 'flow editor opened');
  await assertNoDeadUi(page, `${name}:editor`);
  await shot(page, 'flows-editor');

  const simHeading = page.getByText('Test simulator');
  if (!(await simHeading.count())) {
    fail(name, 'Test simulator panel missing (lg viewport required)');
    return;
  }
  const step = page.getByRole('button', { name: /^step$/i }).first();
  if (!(await step.count())) {
    fail(name, 'simulator Step button missing');
    return;
  }
  await step.click();
  await page.waitForTimeout(600);
  // Second step / reset proves controls are live
  if (await step.isEnabled().catch(() => false)) {
    await step.click();
    await page.waitForTimeout(400);
  }
  const reset = page.getByRole('button', { name: /^reset$/i }).first();
  if (await reset.count()) {
    await reset.click();
    await page.waitForTimeout(300);
  }
  note(name, 'simulator step + reset clicked');
  await shot(page, 'flows-simulate');
}

async function exerciseTemplates(page) {
  const name = 'templates';
  await page.goto(`${BASE}/settings?tab=templates`, { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  await assertNoDeadUi(page, name);
  await shot(page, 'settings-templates');

  const neu = page.getByRole('button', { name: /new template/i }).first();
  if (await neu.count()) {
    await neu.click();
    await page.waitForTimeout(600);
    await shot(page, 'templates-new');
    await page.keyboard.press('Escape').catch(() => {});
    note(name, 'new template opened');
  } else {
    fail(name, 'New Template missing');
  }

  const stubApprove = page.getByRole('button', { name: /stub approve/i }).first();
  if (await stubApprove.count()) {
    await stubApprove.click();
    await page.waitForTimeout(800);
    note(name, 'stub approve clicked');
  } else {
    note(name, 'no pending stub template (ok)');
  }
}

async function exerciseIntegrations(page) {
  const name = 'integrations';
  await page.goto(`${BASE}/settings?tab=integrations`, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  await assertNoDeadUi(page, name);
  await shot(page, 'settings-integrations');

  for (const [provider, fields] of Object.entries(INTEGRATION_FIELDS)) {
    // Find card by heading or text
    const card = page.locator('div').filter({
      has: page.getByRole('button', { name: /connect|update/i }),
    }).filter({ hasText: new RegExp(provider.replace(/_/g, ' '), 'i') }).first();

    // More reliable: click Connect near provider name from catalog display names
    const connectBtns = page.getByRole('button', { name: /^connect$/i });
    const count = await connectBtns.count();
    if (count === 0 && provider === Object.keys(INTEGRATION_FIELDS)[0]) {
      fail(name, 'no Connect buttons found');
      break;
    }
  }

  // Connect each visible Connect button once with matching dialog
  const connectButtons = page.getByRole('button', { name: /^connect$/i });
  const n = await connectButtons.count();
  const max = Math.min(n, Object.keys(INTEGRATION_FIELDS).length);
  for (let i = 0; i < max; i++) {
    const btn = connectButtons.nth(i);
    if (!(await btn.isVisible().catch(() => false))) continue;
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await page.waitForTimeout(500);
    const dialog = page.getByRole('dialog');
    if (!(await dialog.count())) {
      fail(name, `Connect #${i} opened no dialog`);
      continue;
    }
    const title = (await dialog.locator('h2, h3, [data-slot=dialog-title]').first().textContent().catch(() => '')) || '';
    // Fill all visible text inputs in dialog
    const inputs = dialog.locator('input:not([type=hidden])');
    const ic = await inputs.count();
    for (let j = 0; j < ic; j++) {
      const input = inputs.nth(j);
      const typ = await input.getAttribute('type');
      if (typ === 'checkbox' || typ === 'radio') continue;
      const val =
        typ === 'url' || (await input.getAttribute('name'))?.includes('url')
          ? 'https://example.com/hook'
          : `stub-value-${j}`;
      await input.fill(val).catch(() => {});
    }
    const save = dialog.getByRole('button', { name: /save & connect|save|connect/i }).last();
    await save.click();
    await page.waitForTimeout(1200);
    // Dialog should close or show success
    const stillOpen = await dialog.isVisible().catch(() => false);
    if (stillOpen) {
      // Try to read error
      const err = await dialog.innerText().catch(() => '');
      if (/fail|error|missing/i.test(err) && !/save & connect/i.test(err)) {
        fail(name, `connect dialog error for "${title}": ${err.slice(0, 120)}`);
      } else {
        await page.keyboard.press('Escape');
        note(name, `connect dialog for "${title}" — closed manually`);
      }
    } else {
      note(name, `connected via dialog "${title}"`);
    }
  }

  // Test connection on first connected card
  const testBtn = page.getByRole('button', { name: /test connection/i }).first();
  if (await testBtn.count()) {
    await testBtn.click();
    await page.waitForTimeout(1000);
    note(name, 'test connection clicked');
  }
  await shot(page, 'integrations-connected');
}

async function exerciseSettingsTabs(page) {
  const name = 'settings';
  for (const tab of SETTINGS_TABS) {
    await page.goto(`${BASE}/settings?tab=${tab}`, { waitUntil: 'load' });
    await page.waitForTimeout(700);
    await assertNoDeadUi(page, `${name}:${tab}`);
    await shot(page, `settings-${tab}`);
    note(name, `tab ${tab}`);
  }
}

async function exerciseApiKeys(page) {
  const name = 'api-keys';
  await page.goto(`${BASE}/settings?tab=api`, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  const neu = page.getByRole('button', { name: /new api key|create api key|create key/i }).first();
  if (await neu.count()) {
    await neu.click();
    await page.waitForTimeout(500);
    const nameInput = page.locator('input').filter({ hasText: '' }).first();
    // fill name field in dialog
    const dialog = page.getByRole('dialog');
    if (await dialog.count()) {
      const input = dialog.locator('input').first();
      await input.fill(`e2e-${Date.now()}`);
      const create = dialog.getByRole('button', { name: /create|generate|save/i }).last();
      await create.click();
      await page.waitForTimeout(1000);
      note(name, 'API key created');
      // Dismiss secret dialog if any
      await page.keyboard.press('Escape');
    }
  } else {
    fail(name, 'New API key button missing');
  }
  await shot(page, 'settings-api-keys');

  await page.goto(`${BASE}/developers/api`, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await assertNoDeadUi(page, 'developers-api');
  await shot(page, 'developers-api');
  note(name, 'developers/api ok');
}

async function exerciseAds(page) {
  const name = 'ads';
  await page.goto(`${BASE}/ads`, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await assertNoDeadUi(page, name);
  await shot(page, 'ads');
  note(name, 'ads page loaded (empty OK)');
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || '/usr/local/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text();
      // Ignore noisy expected stub/network noise
      if (/favicon|Download the React DevTools|hydration/i.test(t)) return;
      report.consoleErrors.push(t);
    }
  });
  page.on('pageerror', (err) => {
    report.consoleErrors.push(String(err?.message ?? err));
  });
  page.on('response', (res) => {
    const status = res.status();
    const url = res.url();
    if (status >= 500) {
      report.networkErrors.push(`${status} ${url}`);
    }
    if (status === 404 && /\/(api|settings|inbox|contacts|flows)/.test(url)) {
      report.networkErrors.push(`${status} ${url}`);
    }
  });

  const runArea = async (label, fn) => {
    try {
      await dismissOverlays(page);
      await fn();
    } catch (err) {
      fail(label, String(err?.message ?? err));
      await shot(page, `zz-fail-${label}`).catch(() => {});
      await dismissOverlays(page);
    }
  };

  try {
    await login(page);

    for (const [href, key] of NAV) {
      await runArea(`nav:${key}`, () => clickNav(page, href, key));
    }

    await runArea('inbox', () => exerciseInbox(page));
    await runArea('contacts', () => exerciseContacts(page));
    await runArea('broadcasts', () => exerciseBroadcasts(page));
    await runArea('templates', () => exerciseTemplates(page));
    await runArea('flows', () => exerciseFlows(page));
    await runArea('integrations', () => exerciseIntegrations(page));
    await runArea('settings', () => exerciseSettingsTabs(page));
    await runArea('api-keys', () => exerciseApiKeys(page));
    await runArea('ads', () => exerciseAds(page));
  } catch (err) {
    fail('runner', String(err?.message ?? err));
    await shot(page, 'zz-failure').catch(() => {});
  }

  // Console / network rollup — treat actionable product failures as hard fails
  // (WhatsApp-not-configured, stub send errors) so stub-mode E2E stays honest.
  const hardConsole = report.consoleErrors.filter(
    (m) =>
      /hydrat|Minified React|TypeError|ReferenceError|Failed to fetch|WhatsApp not configured|Failed to send message/i.test(
        m,
      ),
  );
  if (hardConsole.length) {
    fail('console', hardConsole.slice(0, 5).join(' | '));
  }
  if (report.networkErrors.length) {
    fail('network', report.networkErrors.slice(0, 8).join(' | '));
  }

  await browser.close();

  const outPath = join(OUT, 'e2e-report.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log('\n=== CHAT-27 E2E SUMMARY ===');
  for (const [k, v] of Object.entries(report.areas)) {
    console.log(`${v.pass ? 'PASS' : 'FAIL'}  ${k}  ${v.notes.slice(0, 3).join('; ')}`);
  }
  console.log('failures', report.failures.length);
  console.log('screenshots', report.screenshots.length);
  console.log('report', outPath);

  if (report.failures.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
