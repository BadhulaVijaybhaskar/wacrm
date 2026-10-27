# Staging rollback — wa.astraconnect.io

Tear down **only** the wacrm staging stack and its nginx site. Other
virtual hosts on the same host are untouched.

## 1. Stop containers

```bash
cd /path/to/wacrm/deploy/staging
docker compose -f docker-compose.staging.yml --env-file .env.staging down
# Optional: also remove the built images
# docker compose -f docker-compose.staging.yml down --rmi local
```

Confirm nothing still listens on the staging ports:

```bash
ss -lntp | grep -E ':3101|:3102' || echo 'ports free'
```

## 2. Remove the nginx site (not other sites)

```bash
sudo rm -f /etc/nginx/sites-enabled/wa.astraconnect.io
sudo rm -f /etc/nginx/sites-available/wa.astraconnect.io
# Leave /etc/nginx/htpasswd/wa.astraconnect.io and Let's Encrypt certs
# in place unless you also want those deleted.
sudo nginx -t
sudo systemctl reload nginx
```

## 3. Verify

```bash
# Should fail to connect / no longer serve this vhost:
curl -sS -o /dev/null -w '%{http_code}\n' https://wa.astraconnect.io/ || true

# Other sites on this host should still respond (example):
# curl -sS -o /dev/null -w '%{http_code}\n' https://other.example.com/
```

## Notes

- This rollback does **not** touch Supabase data or migrations.
- DNS can keep pointing at the host; without the site file nginx will
  serve the default server (or nothing for that name).
- To re-enable later, follow `DEPLOY.md` from step 3 (compose up) and
  reinstall the site file.
