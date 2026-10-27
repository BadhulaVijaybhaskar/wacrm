/**
 * Visual layout test: brand lockup bounding box must fit inside the
 * mobile/desktop header chrome at common viewports. Uses Playwright
 * against a static fixture that mirrors header markup + globals.css
 * lockup rules (no Next server required).
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

function extractLockupCss(src: string): string {
  const marker = '.brand-lockup {'
  const i = src.indexOf(marker)
  if (i < 0) throw new Error('brand-lockup CSS block not found in globals.css')
  return src.slice(i)
}

const FIXTURE = `<!doctype html>
<html lang="en" data-mode="light">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, sans-serif; }
  .h-7 { height: 1.75rem; }
  .max-h-7 { max-height: 1.75rem; }
  .w-auto { width: auto; }
  .max-w-\\[9\\.5rem\\] { max-width: 9.5rem; }
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
    .md\\:hidden { display: none !important; }
  }
  ${extractLockupCss(globalsCss)}
</style>
</head>
<body>
  <header class="av-top" data-testid="app-header">
    <div style="display:flex;align-items:center;gap:8px;min-width:0">
      <button type="button" aria-label="menu" style="width:44px;height:44px">☰</button>
      <span
        class="brand-lockup h-7 max-h-7 w-auto max-w-[9.5rem] md:hidden"
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
    // md:hidden hides the lockup at ≥768 — wait for attachment, not visibility.
    await page.waitForSelector('[data-testid="header-lockup"]', {
      state: 'attached',
    })
    return page.evaluate(() => {
      const header = document.querySelector('[data-testid="app-header"]')
      const lockup = document.querySelector(
        '[data-testid="header-lockup"]',
      ) as HTMLElement | null
      if (!header || !lockup) return null
      const visible = getComputedStyle(lockup).display !== 'none'
      const h = header.getBoundingClientRect()
      const l = lockup.getBoundingClientRect()
      const img = lockup.querySelector(
        '[data-brand-lockup="light"]',
      ) as HTMLElement | null
      const imgBox = img?.getBoundingClientRect()
      return {
        visible,
        header: { top: h.top, bottom: h.bottom, height: h.height, width: h.width },
        lockup: { top: l.top, bottom: l.bottom, height: l.height, width: l.width },
        img: imgBox
          ? { top: imgBox.top, bottom: imgBox.bottom, height: imgBox.height }
          : null,
      }
    })
  }

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

          // md+: lockup is hidden (page title shows instead).
          if (width >= 768) {
            expect(box.visible).toBe(false)
            return
          }

          expect(box.visible).toBe(true)
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
})
