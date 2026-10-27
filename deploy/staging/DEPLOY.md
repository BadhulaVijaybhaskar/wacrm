# Staging deploy — wa.astraconnect.io (operator guide)

Isolated staging for the Astra Connect WhatsApp adapter. **Do not** point
this stack at live Connect or apply migrations from this guide unless a
separate, explicit change request says so.

| Piece | Bind |
|---|---|
| wacrm app | `127.0.0.1:3101` → container `:3000` |
| connect-stub | `127.0.0.1:3102` → container `:8090` |
| Public TLS | nginx → `wa.astraconnect.io` → `127.0.0.1:3101` |

## Prerequisites

- Docker + Compose v2
- nginx + certbot on the host
- A Supabase project the staging app may use (migrations already applied
  there by your normal process — this guide does **not** run them)
- DNS for `wa.astraconnect.io` pointing at this host

## 1. Env file

```bash
cd /path/to/wacrm/deploy/staging
cp .env.staging.example .env.staging
# Edit .env.staging — fill every required value.
# Keep CONNECT_ADAPTER_URL=http://connect-stub:8090 (compose default).
# Generate secrets:
#   openssl rand -hex 32   # WACRM_ADAPTER_SECRET / ENCRYPTION_KEY / etc.
```

Required at minimum:

- `NEXT_PUBLIC_SITE_URL=https://wa.astraconnect.io`
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`
- `META_APP_SECRET` (staging-only secret is fine — see META_STUB below)
- `WACRM_ADAPTER_SECRET` (≥16 chars; shared with `connect-stub`)

## 2. META_STUB (no real Meta app)

When you have **no** production Meta App Secret / WABA:

1. Set `META_STUB=1` in `.env.staging` (documentation flag for operators).
2. Set `META_APP_SECRET` to a long random staging-only value.
3. Set `WHATSAPP_TEMPLATES_DRY_RUN=true` so template submit does not call Graph.
4. Do **not** expect live WhatsApp send/receive. Adapter smoke tests hit
   `connect-stub` only; Meta webhook verification still needs a correctly
   signed `x-hub-signature-256` if you POST to `/api/whatsapp/webhook`.

With a real Meta test WABA, leave `META_STUB` unset / `0` and use the
test app’s `META_APP_SECRET` + phone number credentials in the dashboard.

## 3. Build and start

```bash
cd /path/to/wacrm/deploy/staging
docker compose -f docker-compose.staging.yml --env-file .env.staging up -d --build
docker compose -f docker-compose.staging.yml ps
docker compose -f docker-compose.staging.yml logs -f --tail=100
```

Health:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3101/
curl -sS http://127.0.0.1:3102/health
```

## 4. TLS (Let’s Encrypt)

First time (HTTP server must already answer `/.well-known/acme-challenge/`
or use certbot’s standalone/nginx plugin carefully):

```bash
sudo certbot certonly --nginx -d wa.astraconnect.io
# or: sudo certbot certonly --webroot -w /var/www/html -d wa.astraconnect.io
```

## 5. nginx site + basic auth

```bash
# Connection upgrade map (once per host nginx)
echo 'map $http_upgrade $connection_upgrade { default upgrade; "" close; }' \
  | sudo tee /etc/nginx/conf.d/connection_upgrade.conf

sudo cp nginx/wa.astraconnect.io.conf /etc/nginx/sites-available/wa.astraconnect.io
sudo ln -sf /etc/nginx/sites-available/wa.astraconnect.io /etc/nginx/sites-enabled/wa.astraconnect.io

sudo mkdir -p /etc/nginx/htpasswd
sudo htpasswd -c /etc/nginx/htpasswd/wa.astraconnect.io staginguser   # prompt for password

sudo nginx -t
sudo systemctl reload nginx
```

Confirm Meta webhook path has `auth_basic off` (see comments in the site file).

## 6. Smoke tests

Against the stub (no nginx, no basic auth):

```bash
cd /path/to/wacrm/deploy/staging
export WACRM_ADAPTER_SECRET='(same as .env.staging)'
export CONNECT_STUB_URL=http://127.0.0.1:3102
./scripts/staging-smoke.sh
```

Through nginx (expect **401 without credentials**):

```bash
# Must be 401:
curl -sS -o /dev/null -w '%{http_code}\n' https://wa.astraconnect.io/

# Must be 200/3xx with credentials:
curl -sS -o /dev/null -w '%{http_code}\n' -u staginguser:'PASSWORD' https://wa.astraconnect.io/

# Meta webhook path must NOT require basic auth (signature still required by app):
curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://wa.astraconnect.io/api/whatsapp/webhook
# → typically 401/403 from the app (bad/missing Meta signature), NOT nginx 401 basic.
```

## 7. Enable the adapter for one account

With the app up and an admin session:

```bash
curl -u staginguser:'PASSWORD' -X PATCH \
  https://wa.astraconnect.io/api/whatsapp/config/astra-connect \
  -H 'Content-Type: application/json' \
  -H 'Cookie: ...' \
  -d '{"enabled":true,"tenant_id":"t_staging"}'
```

(`CONNECT_ADAPTER_URL` already points at `http://connect-stub:8090`.)

## Risks

- **Resource caps:** app is limited to 1 GiB / 0.5 CPU — Next.js standalone is fine; large media mirrors may pressure memory.
- **Supabase:** this stack talks to whatever project is in `.env.staging`. Do not point at production without intent.
- **Migrations:** not applied by these files. Migration `043_astra_connect_adapter.sql` must already exist on that project before enabling the adapter UI/API fields.
- **Basic auth ≠ Meta:** forgetting `auth_basic off` on `/api/whatsapp/webhook` silently drops Meta deliveries.
- **Stub is not Connect:** canned replies only; do not use staging stub behaviour as a Connect acceptance test beyond HMAC/payload smoke.
