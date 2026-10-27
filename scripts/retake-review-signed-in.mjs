#!/usr/bin/env node
/**
 * Retake artifacts/review-signed-in/* against a **production** Next server.
 *
 * ALWAYS run against `next build && next start` (NODE_ENV=production).
 * Fails closed if a Next.js dev badge / nextjs-portal is present.
 *
 *   NODE_ENV=production npm run build
 *   NODE_ENV=production npm run start -- -p 3000 -H 127.0.0.1
 *   node scripts/retake-review-signed-in.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'artifacts/review-signed-in');
mkdirSync(OUT, { recursive: true });

const BASE = process.env.SHOT_BASE_URL ?? 'http://127.0.0.1:3000';
const EMAIL = process.env.SHOT_EMAIL ?? 'demo@astraconnect.io';
const PASS = process.env.SHOT_PASSWORD ?? 'demo-password-123';
const PRIYA_CONV_ID =
  process.env.SHOT_PRIYA_CONV_ID ?? '0f3eb4d9-2a9b-461a-9678-d5cdf99928dd';

async function assertProductionPage(page, label) {
  const probe = await page.evaluate(() => {
    const portal = document.querySelector('nextjs-portal');
    const toast = document.querySelector('[data-nextjs-toast]');
    const badge = document.querySelector('[data-next-badge]');
    const text = document.body?.innerText ?? '';
    const issuePill = /\bN\s*\d+\s*Issue/i.test(text);
    return {
      hasPortal: Boolean(portal),
      hasToast: Boolean(toast),
      hasBadge: Boolean(badge),
      issuePill,
      // Turbopack / next-dev markers that must never appear in prod shots.
      // Next 16 production builds may use Turbopack compiler chunk names;
      // only fail on actual DEV markers (HMR / next-devtools / portal).
      hasHmr: Boolean(
        document.querySelector('script[src*="hmr-client"]') ||
          document.querySelector('script[src*="next-devtools"]'),
      ),
      hasErrorOverlay: document.documentElement.innerHTML.includes('__next_error__'),
    };
  });
  if (
    probe.hasPortal ||
    probe.hasToast ||
    probe.hasBadge ||
    probe.issuePill ||
    probe.hasHmr ||
    probe.hasErrorOverlay
  ) {
    throw new Error(
      `[shot-guard] ${label}: Next.js DEV UI detected (${JSON.stringify(probe)}). ` +
        `Shoot only from \`next build && next start\` with NODE_ENV=production.`,
    );
  }
}

async function shot(page, name, opts = {}) {
  await assertProductionPage(page, name);
  await page.screenshot({
    path: join(OUT, name),
    fullPage: !!opts.fullPage,
    animations: 'disabled',
  });
  console.log('wrote', name);
}

async function setMode(page, mode) {
  await page.evaluate((m) => {
    localStorage.setItem('astra.v2.theme', m);
    localStorage.setItem('astra-chat.mode', m);
    let rec = {};
    try {
      rec = JSON.parse(localStorage.getItem('astra-theme') || '{}') || {};
    } catch {
      rec = {};
    }
    rec.dark = m === 'dark';
    localStorage.setItem('astra-theme', JSON.stringify(rec));
    document.documentElement.classList.toggle('dark', m === 'dark');
    document.documentElement.dataset.mode = m;
  }, mode);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(400);
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'load' });
  await page.waitForSelector('[data-brand-lockup="light"]', { state: 'attached', timeout: 20000 });
  await assertProductionPage(page, 'login');
  await page.fill('input#email, input[type=email]', EMAIL);
  await page.fill('input#password, input[type=password]', PASS);
  await Promise.all([
    page.waitForURL(/\/(dashboard|inbox)/, { timeout: 30000 }).catch(() => {}),
    page.click('button[type=submit]'),
  ]);
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (k.includes('whatsapp-banner-dismissed')) localStorage.removeItem(k);
    }
  });
}

async function openPriyaThread(page) {
  await page.goto(`${BASE}/inbox?c=${PRIYA_CONV_ID}`, {
    waitUntil: 'load',
  });
  await page.waitForTimeout(900);
  // Fallback: click the list row if deep-link didn't select.
  const priya = page.getByRole('button', { name: /Priya Sharma/i });
  if (await priya.count()) {
    await priya.first().click().catch(() => {});
    await page.waitForTimeout(600);
  }
}

async function scrollIntegrationsToCrm(page) {
  const crm = page.getByRole('heading', { name: /^CRM$/i });
  if (await crm.count()) {
    await crm.first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    return;
  }
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('[class*="overflow"]')) {
      if (el.scrollHeight > el.clientHeight + 40) {
        el.scrollTop = el.scrollHeight;
      }
    }
  });
  await page.waitForTimeout(400);
}

async function collectConsoleErrors(page, bucket) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      bucket.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    bucket.push(String(err?.message ?? err));
  });
}

/** Fail if the mobile header lockup spills, or if it shows on desktop. */
async function assertHeaderLockupFits(page, label) {
  const probe = await page.evaluate(() => {
    const header = document.querySelector('header.av-top, header');
    if (!header) return { ok: false, reason: 'no-header' };
    const w = window.innerWidth;
    const slot = header.querySelector('[data-testid="header-lockup-slot"]');
    const lockup = header.querySelector('.brand-lockup, [data-brand-lockup]');
    const slotVisible = slot
      ? getComputedStyle(slot).display !== 'none'
      : false;
    const lockupVisible = lockup
      ? getComputedStyle(
          lockup.classList?.contains('brand-lockup')
            ? lockup
            : lockup.closest('.brand-lockup') || lockup,
        ).display !== 'none' &&
        (slot ? slotVisible : true)
      : false;

    // Desktop must not show a second lockup next to the page title.
    if (w >= 768) {
      return {
        ok: !slotVisible && !lockupVisible,
        reason:
          slotVisible || lockupVisible
            ? 'desktop-lockup-visible'
            : 'desktop-hidden',
        width: w,
        slotVisible,
        lockupVisible,
      };
    }

    if (!lockup) {
      return { ok: false, reason: 'missing-lockup', width: w };
    }
    const root = lockup.classList?.contains('brand-lockup')
      ? lockup
      : lockup.closest('.brand-lockup') || lockup;
    const h = header.getBoundingClientRect();
    const l = root.getBoundingClientRect();
    const img =
      root.querySelector('[data-brand-lockup="light"], [data-brand-lockup="dark"]') ||
      root;
    const ib = img.getBoundingClientRect();
    const spill =
      l.bottom > h.bottom + 1 ||
      l.top < h.top - 1 ||
      ib.bottom > h.bottom + 1 ||
      l.height > 32;
    return {
      ok: !spill,
      reason: spill ? 'spill' : 'ok',
      header: { top: h.top, bottom: h.bottom, height: h.height },
      lockup: { top: l.top, bottom: l.bottom, height: l.height, width: l.width },
      img: { top: ib.top, bottom: ib.bottom, height: ib.height },
      width: w,
    };
  });
  if (!probe.ok) {
    throw new Error(
      `[shot-guard] ${label}: header lockup ${JSON.stringify(probe)}`,
    );
  }
  console.log('header-lockup-ok', label, probe.width, probe.reason);
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || '/usr/local/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const hydrationErrors = [];
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await collectConsoleErrors(page, hydrationErrors);

  // Warm login page first — proves prod (no nextjs-portal).
  await page.goto(`${BASE}/login`, { waitUntil: 'load' });
  await assertProductionPage(page, 'preflight');

  await login(page);

  const routes = [
    ['/dashboard', 'dashboard'],
    ['/inbox', 'inbox'],
    ['/contacts', 'contacts'],
    ['/broadcasts', 'broadcasts'],
    ['/settings?tab=templates', 'templates'],
    ['/settings?tab=profile', 'settings'],
    ['/settings?tab=integrations', 'integrations'],
  ];

  for (const mode of ['light', 'dark']) {
    await setMode(page, mode);
    for (const [path, name] of routes) {
      if (name === 'inbox') {
        await page.evaluate(() => {
          for (const k of Object.keys(localStorage)) {
            if (k.includes('whatsapp-banner-dismissed')) {
              localStorage.removeItem(k);
            }
          }
        });
        await openPriyaThread(page);
      } else {
        await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
        await page.waitForTimeout(700);
      }
      await shot(page, `${name}-${mode}.png`);
    }

    await page.goto(`${BASE}/settings?tab=integrations`, {
      waitUntil: 'load',
    });
    await page.waitForTimeout(700);
    await scrollIntegrationsToCrm(page);
    await shot(page, `integrations-scrolled-${mode}.png`);
  }

  // Login shots (signed out)
  await context.clearCookies();
  await page.goto(`${BASE}/login`, { waitUntil: 'load' });
  for (const mode of ['light', 'dark']) {
    await setMode(page, mode);
    // Confirm dark lockup is the visible asset in dark mode.
    if (mode === 'dark') {
      const lockup = await page.evaluate(() => {
        const dark = document.querySelector('[data-brand-lockup="dark"]');
        const light = document.querySelector('[data-brand-lockup="light"]');
        const darkVisible = dark
          ? getComputedStyle(dark).display !== 'none'
          : false;
        const lightVisible = light
          ? getComputedStyle(light).display !== 'none'
          : false;
        return {
          darkSrc: dark?.getAttribute('src'),
          lightSrc: light?.getAttribute('src'),
          darkVisible,
          lightVisible,
        };
      });
      if (
        !lockup.darkVisible ||
        lockup.lightVisible ||
        !String(lockup.darkSrc || '').includes('astra-chat-lockup-dark')
      ) {
        throw new Error(
          `[shot-guard] login-dark lockup wrong: ${JSON.stringify(lockup)}`,
        );
      }
    }
    await shot(page, `login-${mode}.png`);
  }

  const ctx2 = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const p2 = await ctx2.newPage();
  await collectConsoleErrors(p2, hydrationErrors);
  await login(p2);
  await setMode(p2, 'light');

  // Visual guard: lockup must fit the header at the review viewports.
  for (const w of [390, 768, 1024, 1440]) {
    await p2.setViewportSize({ width: w, height: 900 });
    await p2.goto(`${BASE}/settings?tab=profile`, { waitUntil: 'load' });
    await p2.waitForTimeout(500);
    await assertHeaderLockupFits(p2, `settings@${w}`);
  }

  for (const [w, h, name, full] of [
    [390, 844, 'integrations-390.png', true],
    [1024, 768, 'integrations-1024.png', false],
    [1440, 900, 'integrations-1440.png', false],
  ]) {
    await p2.setViewportSize({ width: w, height: h });
    await p2.goto(`${BASE}/settings?tab=integrations`, {
      waitUntil: 'load',
    });
    await p2.waitForTimeout(700);
    await assertHeaderLockupFits(p2, name);
    if (w === 390) await scrollIntegrationsToCrm(p2);
    await shot(p2, name, { fullPage: full });
  }

  await p2.setViewportSize({ width: 390, height: 844 });
  await p2.goto(`${BASE}/settings?tab=profile`, { waitUntil: 'load' });
  await p2.waitForTimeout(700);
  await assertHeaderLockupFits(p2, 'settings-390.png');
  await shot(p2, 'settings-390.png');

  await browser.close();

  const hydration = hydrationErrors.filter(
    (m) =>
      /hydrat/i.test(m) ||
      /Did not expect server HTML/i.test(m) ||
      /Minified React error/i.test(m),
  );
  if (hydration.length) {
    console.error('HYDRATION/REACT ERRORS:');
    for (const m of hydration) console.error(' -', m);
    process.exitCode = 1;
  } else {
    console.log('console: zero hydration/React errors observed');
  }

  if (hydrationErrors.length && !hydration.length) {
    console.log(
      'other console errors (non-hydration):',
      hydrationErrors.slice(0, 10),
    );
  }

  console.log('done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
