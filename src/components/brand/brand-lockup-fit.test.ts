/**
 * Visual layout test: brand lockup bounding box must fit inside the
 * mobile header, and must stay hidden at ≥768px next to the page title.
 *
 * Uses Playwright against a static fixture that mirrors header markup +
 * globals.css lockup rules with real CSS layers (no Next server required).
 * `md:hidden` is a utilities-layer rule WITHOUT !important — so this
 * fails if `.brand-lockup { display: inline-block }` is left unlayered.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const VIEWPORTS = [390, 768, 1024, 1440] as const
const HEADER_H_MOBILE = 56 // h-14
const HEADER_H_DESKTOP = 64 // md:h-16
const LOCKUP_MAX_H = 28 // h-7

const globalsCss = readFileSync(
  join(process.cwd(), 'src/app/globals.css'),
  'utf8',
)

/** Pull the `.brand-lockup` block from inside `@layer components`. */
function extractLockupCss(src: string): string {
  const marker = '.brand-lockup {'
  const i = src.indexOf(marker)
  if (i < 0) throw new Error('brand-lockup CSS block not found in globals.css')
  // Include through the light/dark swap rules that follow in the same layer.
  const endMarkers = [
    src.indexOf('/* Pro shell */', i),
    src.indexOf('\n}\n\n/* Pro shell */', i),
  ].filter((n) => n > i)
  // Slice from .brand-lockup to just before the closing of @layer components
  // that follows the light-mode swap (html[data-mode='light'] .brand-lockup-dark).
  const lightDark = src.indexOf("html[data-mode='light'] .brand-lockup-dark", i)
  if (lightDark < 0) throw new Error('brand-lockup dark-swap end not found')
  const close = src.indexOf('}', lightDark)
  if (close < 0) throw new Error('brand-lockup block unterminated')
  void endMarkers
  return src.slice(i, close + 1)
}

function assertLockupIsLayered(src: string) {
  const layerIdx = src.indexOf('@layer components')
  const lockupIdx = src.indexOf('.brand-lockup {')
  expect(layerIdx).toBeGreaterThanOrEqual(0)
  expect(lockupIdx).toBeGreaterThan(layerIdx)
  // Ensure there is no unlayered duplicate after the components layer closes
  // before Pro shell / end of file.
  const afterLayer = src.indexOf('/* Pro shell */')
  if (afterLayer > 0) {
    expect(src.slice(afterLayer).includes('.brand-lockup {')).toBe(false)
  }
}

const lockupRules = extractLockupCss(globalsCss)

const FIXTURE = `<!doctype html>
<html lang="en" data-mode="light">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  /* Mirror Tailwind's layer order: utilities beat components. */
  @layer theme, base, components, utilities;

  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, sans-serif; }

  @layer components {
    ${lockupRules}
  }

  @layer utilities {
    .h-7 { height: 1.75rem; }
    .max-h-7 { max-height: 1.75rem; }
    .w-auto { width: auto; }
    .max-w-\\[9\\.5rem\\] { max-width: 9.5rem; }
    .hidden { display: none; }
    .md\\:block { display: none; }
    @media (min-width: 768px) {
      /* No !important — must win over .brand-lockup { display:inline-block }. */
      .md\\:hidden { display: none; }
      .md\\:block { display: block; }
    }
  }

  header.av-top {
    display: flex;
    height: ${HEADER_H_MOBILE}px;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 8px;
    border-bottom: 1px solid #ddd;
    background: #fff;
  }
  @media (min-width: 768px) {
    header.av-top { height: ${HEADER_H_DESKTOP}px; }
  }
</style>
</head>
<body>
  <header class="av-top" data-testid="app-header">
    <div style="display:flex;align-items:center;gap:8px;min-width:0">
      <button type="button" aria-label="menu" class="md:hidden" style="width:44px;height:44px">☰</button>
      <span class="md:hidden" data-testid="header-lockup-slot">
        <span
          class="brand-lockup h-7 max-h-7 w-auto max-w-[9.5rem]"
          data-testid="header-lockup"
        >
          <img
            src="/brand/astra-chat-lockup-275.png"
            alt="Astra Chat"
            width="154"
            height="28"
            data-brand-lockup="light"
            class="brand-lockup-light brand-lockup-img"
          />
          <img
            src="/brand/astra-chat-lockup-dark-275.png"
            alt=""
            aria-hidden="true"
            width="154"
            height="28"
            data-brand-lockup="dark"
            class="brand-lockup-dark brand-lockup-img"
          />
        </span>
      </span>
      <h1 class="hidden md:block" data-testid="header-title" style="font-size:1.125rem;margin:0">
        Settings
      </h1>
    </div>
    <div style="width:72px;height:32px;background:#eee;border-radius:8px"></div>
  </header>
</body>
</html>`

describe('BrandLockup header fit (visual)', () => {
  let browser: Browser
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    assertLockupIsLayered(globalsCss)

    const publicDir = join(process.cwd(), 'public')
    server = createServer((req, res) => {
      if (req.url === '/' || req.url?.startsWith('/?')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(FIXTURE)
        return
      }
      if (req.url?.startsWith('/brand/')) {
        try {
          const file = join(publicDir, req.url.slice(1))
          const data = readFileSync(file)
          res.writeHead(200, { 'Content-Type': 'image/png' })
          res.end(data)
          return
        } catch {
          res.writeHead(404)
          res.end('missing')
          return
        }
      }
      res.writeHead(404)
      res.end('no')
    })
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const addr = server.address()
    if (!addr || typeof addr === 'string') throw new Error('no port')
    baseUrl = `http://127.0.0.1:${addr.port}`
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
    })
  })

  async function measure(page: Page, width: number) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto(baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[data-testid="header-lockup"]', {
      state: 'attached',
    })
    return page.evaluate(() => {
      const header = document.querySelector('[data-testid="app-header"]')
      const slot = document.querySelector(
        '[data-testid="header-lockup-slot"]',
      ) as HTMLElement | null
      const lockup = document.querySelector(
        '[data-testid="header-lockup"]',
      ) as HTMLElement | null
      const title = document.querySelector(
        '[data-testid="header-title"]',
      ) as HTMLElement | null
      if (!header || !lockup || !slot) return null
      const slotVisible = getComputedStyle(slot).display !== 'none'
      const lockupVisible = getComputedStyle(lockup).display !== 'none'
      const titleVisible = title
        ? getComputedStyle(title).display !== 'none'
        : false
      const h = header.getBoundingClientRect()
      const l = lockup.getBoundingClientRect()
      const img = lockup.querySelector(
        '[data-brand-lockup="light"]',
      ) as HTMLElement | null
      const imgBox = img?.getBoundingClientRect()
      return {
        slotVisible,
        lockupVisible,
        titleVisible,
        header: { top: h.top, bottom: h.bottom, height: h.height, width: h.width },
        lockup: { top: l.top, bottom: l.bottom, height: l.height, width: l.width },
        img: imgBox
          ? { top: imgBox.top, bottom: imgBox.bottom, height: imgBox.height }
          : null,
      }
    })
  }

  it('keeps .brand-lockup rules inside @layer components', () => {
    assertLockupIsLayered(globalsCss)
  })

  for (const width of VIEWPORTS) {
    it(
      `lockup fits inside header at ${width}px`,
      async () => {
        const page = await browser.newPage()
        try {
          const box = await measure(page, width)
          expect(box).not.toBeNull()
          if (!box) return

          const expectedHeaderH =
            width >= 768 ? HEADER_H_DESKTOP : HEADER_H_MOBILE
          expect(box.header.height).toBe(expectedHeaderH)

          if (width >= 768) {
            // Desktop: page title only — no second lockup beside it.
            expect(box.slotVisible).toBe(false)
            expect(box.titleVisible).toBe(true)
            return
          }

          expect(box.slotVisible).toBe(true)
          expect(box.lockupVisible).toBe(true)
          expect(box.titleVisible).toBe(false)
          expect(box.lockup.height).toBeLessThanOrEqual(LOCKUP_MAX_H + 0.5)
          expect(box.lockup.top).toBeGreaterThanOrEqual(box.header.top - 0.5)
          expect(box.lockup.bottom).toBeLessThanOrEqual(
            box.header.bottom + 0.5,
          )
          if (box.img) {
            expect(box.img.height).toBeLessThanOrEqual(LOCKUP_MAX_H + 0.5)
            expect(box.img.bottom).toBeLessThanOrEqual(
              box.header.bottom + 0.5,
            )
          }
        } finally {
          await page.close()
        }
      },
      20_000,
    )
  }

  it(
    'header lockup is hidden at >=768px (md:hidden beats .brand-lockup display)',
    async () => {
      const page = await browser.newPage()
      try {
        for (const width of [768, 1024, 1440] as const) {
          const box = await measure(page, width)
          expect(box, `viewport ${width}`).not.toBeNull()
          expect(box!.slotVisible, `slot visible at ${width}`).toBe(false)
          expect(box!.titleVisible, `title hidden at ${width}`).toBe(true)
        }
      } finally {
        await page.close()
      }
    },
    30_000,
  )
})
