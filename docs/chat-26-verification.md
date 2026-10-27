# CHAT-26 re-verification (CHAT-13 / 14 / 15 over CHAT-16→25)

Branch: `cursor/astra-connect-adapter-f6ad`

## Results

| Check | Result |
| --- | --- |
| White-label re-scan (CHAT-13) | `artifacts/chat-26/white-label-scan.txt` — `poweredByHeader: false`, source maps `0`, scrub script present. Remaining github/gitlab hits are source comments / scrub tooling / docs only. |
| Full tests (CHAT-14) | **132** files, **1293** tests passed; `tsc --noEmit` exit **0** |
| UI control audit (CHAT-15) | `artifacts/chat-26/ui-control-audit.md` — all new CHAT-16→25 controls wired or stub-gated |
| Screenshots | Prior task artifacts `artifacts/chat-16`…`chat-25` plus re-captures below |

## Screenshots inventory

| Artifact | Screen |
| --- | --- |
| `artifacts/chat-16/integrations-hub.png` | Integrations hub |
| `artifacts/chat-17/public-api-docs.png` | Public API docs |
| `artifacts/chat-18/shopify-woocommerce.png` | Commerce cards |
| `artifacts/chat-19/payment-link-dialog.png` | Payment link |
| `artifacts/chat-20/google-sheets-card.png` | Google Sheets |
| `artifacts/chat-21/crm-cards.png` | CRM push |
| `artifacts/chat-22/unified-inbox-channels.png` | Channel filter |
| `artifacts/chat-23/flow-builder-simulator.png` | Flow builder + simulator |
| `artifacts/chat-24/ads-attribution.png` | Ads report |
| `artifacts/chat-25/intents-manager.png` | Intents |

## Migrations owner must apply (048–057)

See `docs/morning-list.md`.
