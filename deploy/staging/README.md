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

Start with **`DEPLOY.md`**. Port **3101** is reserved for the app.
