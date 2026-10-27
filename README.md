# Astra Chat

Self-hostable WhatsApp® CRM — shared inbox, contacts, sales pipelines,
broadcasts, automations, and Astra Connect. Fork it, brand it, host it.

[![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](./LICENSE)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth-3ecf8e?logo=supabase)](https://supabase.com)

## What you get out of the box

- **Shared inbox** on the official WhatsApp Business API — multiple
  agents working one number, per-conversation assignment, status, and
  notes.
- **Contacts + tags + custom fields**, CSV import, deduplication.
- **Sales pipelines** (Kanban) with deals linked to conversations.
- **Broadcasts** with Meta-approved templates, delivery + read
  tracking, per-recipient variable substitution.
- **No-code automations** — triggers on inbound messages, new
  contacts, keywords, or schedule; conditional branches, waits,
  tags, webhooks. Visual builder.
- **AI reply assistant** — bring your own OpenAI or Anthropic key
  (stored encrypted). Optional auto-reply with human handoff and a
  knowledge base (Postgres full-text, or semantic pgvector when an
  embeddings key is set).
- **Astra Connect** — signed adapter + read API so Connect AI
  Employees can work your inbox with takeover and usage metering.
- **Integrations hub** — outbound webhooks, Zapier/Make, Shopify,
  WooCommerce, Razorpay, Stripe, Google Sheets, HubSpot, Zoho, and
  Astra CRM.
- **Real-time dashboard** — response times, daily volume, pipeline
  value, cross-module activity feed.
- **Team accounts** — invite teammates by link, role-based access
  (owner / admin / agent / viewer), ownership transfer.
- **Public REST API** (`/api/v1`) with scoped, revocable API keys —
  see [docs/public-api.md](./docs/public-api.md).
- **MCP server** — drive your CRM from Claude, Cursor, and other AI
  assistants over the [Model Context Protocol](https://modelcontextprotocol.io).
  See [docs/mcp.md](./docs/mcp.md) (server in [`mcp-server/`](./mcp-server)).

## Quick start

```bash
git clone https://github.com/BadhulaVijaybhaskar/wacrm.git
cd wacrm
npm install
cp .env.local.example .env.local   # fill in Supabase + Meta creds
npm run dev
```

Open <http://localhost:3000>. You'll be redirected to `/login` (or
`/dashboard` if already signed in).

The UI ships in English, Korean, Brazilian Portuguese and Spanish — set
`NEXT_PUBLIC_APP_LOCALE` to `en`, `ko`, `pt` or `es` in `.env.local`
(catalogues live in `messages/`).

Prefer containers? See [docs/docker.md](./docs/docker.md).

## Documentation

In-repo guides:

- [Public API](./docs/public-api.md)
- [Astra Connect adapter](./docs/astra-connect-adapter.md)
- [Astra Connect read API](./docs/astra-connect-read-api.md)
- [MCP server](./docs/mcp.md)
- [Docker](./docs/docker.md)
- [WhatsApp connection troubleshooting](./docs/whatsapp-connection-troubleshooting.md)
- [Several WABAs on one deployment](./docs/multi-waba.md)
- [Morning list / credentials checklist](./docs/morning-list.md)

## Stack

- **App** — Next.js 16 (App Router), React 19, TypeScript, Tailwind v4.
- **Data** — Supabase (Postgres + Auth + Storage + RLS).
- **WhatsApp** — Meta Cloud API (official WhatsApp Business API).

## Contributing

Bug reports and security issues are welcome. Details in
[`CONTRIBUTING.md`](./CONTRIBUTING.md) and
[`.github/SECURITY.md`](./.github/SECURITY.md).

## License

[MIT](./LICENSE). Fork it, brand it, host it.
