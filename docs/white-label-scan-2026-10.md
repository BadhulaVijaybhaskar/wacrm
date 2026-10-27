# White-label scan — 2026-10 (CHAT-13)

Ran `npm run build` (`next build` + `scripts/scrub-client-bundles.mjs`) on
`cursor/astra-connect-adapter-f6ad`.

## Build scrub

- Rewrote 6 client/server asset files; removed 8 embedded `example.com` /
  other forge diagnostic URLs from third-party bundles.
- Brand grep (`wacrm`, `Upstream`, `example.com`, “crm template for whatsapp”):
  **zero hits** in `.next/static`, `.next/server/app|pages`, `public/`.

## Grep surfaces

| Surface | Result |
| --- | --- |
| `.next/static` + server HTML/RSC | No upstream/OSS product names; no repo URLs after scrub |
| `public/` | Clean (Astra favicons / icons only) |
| Emails | `public/brand/email-header.png` only; no source emails with upstream names |
| Response headers | `poweredByHeader: false`; security headers only — no `X-Powered-By` |
| Source maps | `productionBrowserSourceMaps: false`; **0** `*.map` under `.next/static` |
| Manifest | `src/app/manifest.ts` → name/short_name **Astra Chat** |
| Favicons / OG | `/icons/*`, `/favicon.ico`, OG `/brand/og.png` — Astra Chat branding |

## Internal names (intentionally unchanged)

- npm package name `wacrm`, API key prefix `wacrm_live_`, code comments /
  docs referencing internal module names — not shipped in client HTML.

## Artifact

`artifacts/chat-13/white-label-scan.txt`
