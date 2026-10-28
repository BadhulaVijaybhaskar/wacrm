#!/usr/bin/env node
/**
 * Items 4–5 UI evidence — prod build, signed-in seed.
 *
 *   META_STUB=1 INTEGRATIONS_STUB=1 WHATSAPP_TEMPLATES_DRY_RUN=1 \
 *     NODE_ENV=production npm run start -- -p 3000 -H 127.0.0.1
 *   node scripts/items-4-5-screenshots.mjs
 *
 * Writes PNGs under artifacts/item-4/ and artifacts/item-5/.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.SHOT_BASE_URL ?? 'http://127.0.0.1:3000';
const EMAIL = process.env.SHOT_EMAIL ?? 'demo@astraconnect.io';
const PASS = process.env.SHOT_PASSWORD ?? 'demo-password-123';
const OUT4 = join(process.cwd(), 'artifacts/item-4');
const OUT5 = join(process.cwd(), 'artifacts/item-5');
mkdirSync(OUT4, { recursive: true });
mkdirSync(OUT5, { recursive: true });

const report = { screenshots: [], failures: [], notes: [] };

function note(msg) {
  report.notes.push(msg);
  console.log('OK', msg);
}

function fail(msg) {
  report.failures.push(msg);
  console.error('FAIL', msg);
}

async function shot(page, dir, name) {
  const file = `${name}.png`;
  const path = join(dir, file);
  await page.screenshot({ path, animations: 'disabled', fullPage: false });
  const rel = dir.includes('item-4')
    ? `artifacts/item-4/${file}`
    : `artifacts/item-5/${file}`;
  report.screenshots.push(rel);
  console.log('shot', rel);
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
    fail(`still on login: ${page.url()}`);
    throw new Error('login failed');
  }
  note(`signed in as ${EMAIL}`);
}

async function openSettingsTab(page, tab) {
  await page.goto(`${BASE}/settings?tab=${tab}`, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
}

async function item4(page) {
  // 4a — Connect on/off switch
  await openSettingsTab(page, 'astra-connect');
  const toggle = page.locator('#astra-connect-enabled');
  if (!(await toggle.count())) {
    fail('4a: Connect switch missing');
  } else {
    note('4a: Connect switch visible');
  }
  await shot(page, OUT4, '4a-astra-connect-switch');

  // 4b — generate / rotate / reveal-once
  const gen = page.getByRole('button', { name: /^generate$/i }).first();
  const rot = page.getByRole('button', { name: /^rotate$/i }).first();
  if ((await gen.count()) && (await gen.isEnabled())) {
    await gen.click();
    await page.waitForTimeout(800);
    const reveal = page.getByText(/copy your secret now/i);
    if (await reveal.count()) note('4b: reveal-once after generate');
    else note('4b: generate clicked (reveal may already exist)');
  } else if ((await rot.count()) && (await rot.isEnabled())) {
    await rot.click();
    await page.waitForTimeout(800);
    note('4b: rotate clicked (secret already existed)');
  } else {
    fail('4b: neither Generate nor Rotate enabled');
  }
  const revealBox = page.getByText(/copy your secret now/i).first();
  if (await revealBox.count()) {
    await revealBox.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(200);
  }
  await shot(page, OUT4, '4b-secret-generate-rotate');

  // 4c — usage & billing
  await openSettingsTab(page, 'usage');
  const usageHead = page.getByText(/usage & billing/i).first();
  if (!(await usageHead.count())) fail('4c: Usage panel missing');
  else note('4c: Usage panel loaded');
  await page.waitForTimeout(600);
  await shot(page, OUT4, '4c-usage-billing');
}

async function item5(page) {
  // 5a — templates
  await openSettingsTab(page, 'templates');
  await page.waitForTimeout(800);
  const newTpl = page
    .getByRole('button', { name: /new template|create template|add template/i })
    .first();
  if (await newTpl.count()) {
    await newTpl.click();
    await page.waitForTimeout(600);
    note('5a: new template dialog opened');
    await shot(page, OUT5, '5a-templates');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  } else {
    await shot(page, OUT5, '5a-templates');
    note('5a: templates list (no new button — still evidenced)');
  }

  // 5b — inbox upgrades
  await page.goto(`${BASE}/inbox`, { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  const row = page
    .locator('[class*="conversation"], button')
    .filter({ hasText: /Priya|Jordan|Amelia|\+\d/ })
    .first();
  if (await row.count()) {
    await row.click().catch(() => {});
    await page.waitForTimeout(800);
  }
  const assign = page.getByRole('button', { name: /assign/i }).first();
  if (await assign.count()) {
    await assign.click();
    await page.waitForTimeout(400);
    note('5b: assign menu opened');
    await page.keyboard.press('Escape');
  } else {
    note('5b: assign control not on this thread (filters/search still shown)');
  }
  await shot(page, OUT5, '5b-inbox-upgrades');

  // 5c — CSV import
  await page.goto(`${BASE}/contacts`, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  const imp = page.getByRole('button', { name: /import/i }).first();
  if (await imp.count()) {
    await imp.click();
    await page.waitForTimeout(600);
    note('5c: import dialog opened');
  } else {
    fail('5c: Import button missing');
  }
  await shot(page, OUT5, '5c-contacts-csv-import');
  await page.keyboard.press('Escape');

  // 5d — opt-out list
  await openSettingsTab(page, 'consent');
  await page.waitForTimeout(800);
  const consentHead = page.getByText(/consent|opt-out/i).first();
  if (!(await consentHead.count())) fail('5d: Consent panel missing');
  else note('5d: Consent / opt-out panel loaded');
  await shot(page, OUT5, '5d-consent-opt-out');
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  page.on('pageerror', (err) => fail(`pageerror: ${err.message}`));

  try {
    await login(page);
    await item4(page);
    await item5(page);
  } finally {
    await browser.close();
    writeFileSync(
      join(process.cwd(), 'artifacts/item-4/e2e-report.json'),
      JSON.stringify(report, null, 2),
    );
    writeFileSync(
      join(process.cwd(), 'artifacts/item-5/e2e-report.json'),
      JSON.stringify(report, null, 2),
    );
  }

  console.log(
    JSON.stringify(
      {
        screenshots: report.screenshots.length,
        failures: report.failures.length,
        notes: report.notes.length,
      },
      null,
      2,
    ),
  );
  if (report.failures.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
