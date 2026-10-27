# CHAT-26 UI control audit (GOLDEN RULE)

Scope: every **new** visible control from CHAT-16→25. Rule: works end-to-end, or hidden.

| Surface | Controls | End-to-end path | Verdict |
| --- | --- | --- | --- |
| Settings → Integrations | Connect / Disconnect / Test / Event log | `/api/integrations/*` + encrypted store + stub test | **OK** — Test uses INTEGRATIONS_STUB/META_STUB; live needs morning-list secrets |
| Developers / webhooks / API docs | Create endpoint, sample payload, Zapier subscribe | `/api/webhooks/*`, `/developers/api` | **OK** |
| Shopify / Woo cards | Connect + Test | Commerce webhooks HMAC/secret verified | **OK** (stub) |
| Payment link composer | Create link action | Mock link in stub; webhook updates timeline | **OK** (stub) |
| Google Sheets card | Connect / sync | OAuth scaffold + mocked Sheets API | **OK** — OAuth live needs Google client |
| CRM cards (HubSpot/Zoho/Astra) | Connect / Test / push | Stub push + retry log | **OK** (stub) |
| Inbox channel filter | WhatsApp / IG / Messenger | Filter + Meta messaging stub send/receive | **OK** |
| Flow editor | New node types + Step simulator | Client-safe `simulateFlowStep`; engine stubs http/delay/AI | **OK** |
| Ads report `/ads` | Table load | `/api/ads/attribution` | **OK** — empty until CTWA inbound |
| AI Agents → Intents | Create / enable / delete / Match locally | `/api/intents*` CRUD + match | **OK** |

Hidden / not shown when unavailable: live Meta Graph send buttons remain stub-gated; Connect adapter replies only when configured.
