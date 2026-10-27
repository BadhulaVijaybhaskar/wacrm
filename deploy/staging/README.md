# Staging deploy pack (isolated)

Files for a **local-only / host-bound** staging deploy of wacrm + a Connect
adapter stub. Nothing here deploys or migrates by itself.

| File | Purpose |
|---|---|
| `Dockerfile` | Next.js standalone production image |
| `docker-compose.staging.yml` | App on `127.0.0.1:3101`, stub on `127.0.0.1:3102` |
| `connect-stub/` | HMAC Connect endpoints with canned replies |
| `.env.staging.example` | Variable names (no secrets) |
| `nginx/wa.astraconnect.io.conf` | DRAFT TLS + basic auth site file |
| `DEPLOY.md` | Operator steps |
| `ROLLBACK.md` | Tear-down without touching other sites |
| `scripts/staging-smoke.sh` | Stub (+ optional nginx) smoke tests |
| `scripts/seed-demo-data.mjs` | Idempotent Astra Chat **test-only** contacts/tags for an existing account |
| `scripts/chat-14-verify.sh` | Local CHAT-14 gate: seed dry-run + stub tests + live smoke |

Start with **`DEPLOY.md`**. Port **3101** is reserved for the app.

### Seed demo data (test data only)

Requires an existing `auth.users` row and its `accounts` / `profiles` membership
(no user creation — keeps the script off the auth admin surface). Writes only
demo CRM rows (`tags`, `contacts`, `contact_tags`, `conversations`,
`contact_notes`) with fake `+1555…` phones / `astrachat.example` emails:

```bash
SEED_ACCOUNT_ID=… SEED_USER_ID=… \
NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
node deploy/staging/scripts/seed-demo-data.mjs
```

`--dry-run` prints the payload without writing. Unit check:

```bash
node --test deploy/staging/scripts/seed-demo-data.test.mjs
```

### CHAT-14 local verify

```bash
bash deploy/staging/scripts/chat-14-verify.sh
# → artifacts/chat-14/verify.log
```
