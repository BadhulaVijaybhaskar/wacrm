#!/usr/bin/env bash
# Staging smoke tests against the Connect adapter stub (and optional app).
#
# Usage (stub only — default after compose up):
#   export WACRM_ADAPTER_SECRET='same-as-.env.staging'
#   export CONNECT_STUB_URL=http://127.0.0.1:3102
#   ./scripts/staging-smoke.sh
#
# Optional:
#   APP_URL=http://127.0.0.1:3101 ./scripts/staging-smoke.sh
#   NGINX_URL=https://wa.astraconnect.io BASIC_USER=… BASIC_PASS=… ./scripts/staging-smoke.sh
#
# Covers: inbound reply, outbound /message, handoff, bad/stale signatures,
# media URL shape for WACRM_MEDIA_HOSTS, and 429 Retry-After (when the stub
# is configured with RATE_LIMIT_EVERY).
set -euo pipefail

STUB_URL="${CONNECT_STUB_URL:-http://127.0.0.1:3102}"
SECRET="${WACRM_ADAPTER_SECRET:-}"
SITE_ORIGIN="${NEXT_PUBLIC_SITE_URL:-https://wa.astraconnect.io}"
FAILS=0

if [[ ${#SECRET} -lt 16 ]]; then
  echo "FAIL: set WACRM_ADAPTER_SECRET (≥16 chars)" >&2
  exit 1
fi

ts_now() { date +%s; }

sign_body() {
  local ts="$1" body="$2"
  printf '%s' "$ts.$body" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print "sha256="$2}'
}

post_signed() {
  local path="$1" body="$2"
  local ts sig
  ts="$(ts_now)"
  sig="$(sign_body "$ts" "$body")"
  curl -sS -D /tmp/wacrm-smoke-headers.$$ -o /tmp/wacrm-smoke-body.$$ \
    -X POST "$STUB_URL$path" \
    -H "Content-Type: application/json" \
    -H "X-Astra-Timestamp: $ts" \
    -H "X-Astra-Signature: $sig" \
    --data-binary "$body"
  BODY="$(cat /tmp/wacrm-smoke-body.$$)"
  HEADERS="$(cat /tmp/wacrm-smoke-headers.$$)"
  STATUS="$(printf '%s' "$HEADERS" | awk 'NR==1 {print $2}')"
}

expect_status() {
  local want="$1" label="$2"
  if [[ "$STATUS" != "$want" ]]; then
    echo "FAIL [$label]: expected HTTP $want, got $STATUS body=$BODY" >&2
    FAILS=$((FAILS + 1))
    return 1
  fi
  echo "PASS [$label]: HTTP $want"
}

json_field() {
  # Minimal extractor: "key": value  (string or bool/null)
  local key="$1"
  printf '%s' "$BODY" | sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" | head -1
}

echo "== health =="
HC="$(curl -sS -o /tmp/wacrm-smoke-body.$$ -w '%{http_code}' "$STUB_URL/health" || true)"
BODY="$(cat /tmp/wacrm-smoke-body.$$)"
STATUS="$HC"
expect_status 200 "stub /health" || true

MID="wamid.smoke.$(date +%s).$RANDOM"
INBOUND="$(printf '%s' "{\"tenant_id\":\"t_staging\",\"phone_number_id\":\"106540352242922\",\"customer_phone\":\"+919812345678\",\"customer_name\":\"Priya\",\"message_id\":\"$MID\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"text\":\"What is the price of the 3 kW kit?\"}")"

echo "== inbound reply =="
post_signed /api/channels/whatsapp/inbound "$INBOUND"
expect_status 200 "inbound" || true
REPLY="$(json_field reply_text)"
CONV="$(json_field conversation_id)"
if [[ -z "$REPLY" || "$REPLY" == "null" ]]; then
  echo "FAIL [inbound]: missing reply_text ($BODY)" >&2
  FAILS=$((FAILS + 1))
else
  echo "PASS [inbound]: reply_text present"
fi
if [[ -z "$CONV" ]]; then
  echo "FAIL [inbound]: missing conversation_id" >&2
  FAILS=$((FAILS + 1))
else
  echo "PASS [inbound]: conversation_id=$CONV"
fi

echo "== idempotent replay =="
post_signed /api/channels/whatsapp/inbound "$INBOUND"
expect_status 200 "inbound replay" || true
if printf '%s' "$BODY" | grep -q '"duplicate"[[:space:]]*:[[:space:]]*true'; then
  echo "PASS [inbound replay]: duplicate=true"
else
  echo "FAIL [inbound replay]: expected duplicate=true ($BODY)" >&2
  FAILS=$((FAILS + 1))
fi

echo "== bad signature =="
ts="$(ts_now)"
curl -sS -o /tmp/wacrm-smoke-body.$$ -w '%{http_code}' \
  -X POST "$STUB_URL/api/channels/whatsapp/inbound" \
  -H "Content-Type: application/json" \
  -H "X-Astra-Timestamp: $ts" \
  -H "X-Astra-Signature: sha256=deadbeef" \
  --data-binary "$INBOUND" >/tmp/wacrm-smoke-status.$$
STATUS="$(cat /tmp/wacrm-smoke-status.$$)"
BODY="$(cat /tmp/wacrm-smoke-body.$$)"
expect_status 401 "bad signature" || true
if printf '%s' "$BODY" | grep -q 'bad_signature'; then
  echo "PASS [bad signature]: code=bad_signature"
else
  echo "FAIL [bad signature]: expected code bad_signature ($BODY)" >&2
  FAILS=$((FAILS + 1))
fi

echo "== stale timestamp =="
STALE=$(( $(ts_now) - 400 ))
SIG="$(sign_body "$STALE" "$INBOUND")"
curl -sS -o /tmp/wacrm-smoke-body.$$ -w '%{http_code}' \
  -X POST "$STUB_URL/api/channels/whatsapp/inbound" \
  -H "Content-Type: application/json" \
  -H "X-Astra-Timestamp: $STALE" \
  -H "X-Astra-Signature: $SIG" \
  --data-binary "$INBOUND" >/tmp/wacrm-smoke-status.$$
STATUS="$(cat /tmp/wacrm-smoke-status.$$)"
BODY="$(cat /tmp/wacrm-smoke-body.$$)"
expect_status 401 "stale signature" || true
if printf '%s' "$BODY" | grep -q 'stale_signature'; then
  echo "PASS [stale signature]: code=stale_signature"
else
  echo "FAIL [stale signature]: expected stale_signature ($BODY)" >&2
  FAILS=$((FAILS + 1))
fi

echo "== human /message =="
MOUT="wamid.smoke.out.$RANDOM"
MSG="$(printf '%s' "{\"tenant_id\":\"t_staging\",\"phone_number_id\":\"106540352242922\",\"customer_phone\":\"+919812345678\",\"message_id\":\"$MOUT\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"author\":\"human\",\"text\":\"Thanks, we will call you.\",\"sent_by\":\"agent@acme.com\"}")"
post_signed /api/channels/whatsapp/message "$MSG"
expect_status 200 "/message" || true
if printf '%s' "$BODY" | grep -q '"stored"[[:space:]]*:[[:space:]]*true'; then
  echo "PASS [/message]: stored=true"
else
  echo "FAIL [/message]: expected stored=true ($BODY)" >&2
  FAILS=$((FAILS + 1))
fi

echo "== handoff:false =="
if [[ -z "$CONV" ]]; then CONV="conv_stub_smoke"; fi
HO="$(printf '%s' "{\"tenant_id\":\"t_staging\",\"conversation_id\":\"$CONV\",\"handoff\":false,\"by\":\"agent@acme.com\",\"reason\":\"agent_closed\"}")"
post_signed /api/channels/whatsapp/handoff "$HO"
expect_status 200 "handoff:false" || true
if printf '%s' "$BODY" | grep -q '"handoff"[[:space:]]*:[[:space:]]*false'; then
  echo "PASS [handoff]: handoff=false"
else
  echo "FAIL [handoff]: expected handoff=false ($BODY)" >&2
  FAILS=$((FAILS + 1))
fi

echo "== media URL shape (https host for WACRM_MEDIA_HOSTS) =="
# Staging signed media URLs are minted by the app; here we only assert the
# public origin operators must use so Connect (or the stub docs) allow-lists it.
case "$SITE_ORIGIN" in
  https://wa.astraconnect.io*) echo "PASS [media]: NEXT_PUBLIC_SITE_URL is https://wa.astraconnect.io" ;;
  https://*) echo "WARN [media]: SITE_ORIGIN=$SITE_ORIGIN — ensure it is in Connect WACRM_MEDIA_HOSTS" ;;
  *)
    echo "FAIL [media]: SITE_ORIGIN must be https (got $SITE_ORIGIN)" >&2
    FAILS=$((FAILS + 1))
    ;;
esac

echo "== 429 rate limit (best-effort; needs RATE_LIMIT_EVERY on stub) =="
GOT_429=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  RID="wamid.smoke.rate.$RANDOM.$i"
  RB="$(printf '%s' "{\"tenant_id\":\"t_staging\",\"phone_number_id\":\"106540352242922\",\"customer_phone\":\"+919812345678\",\"message_id\":\"$RID\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"text\":\"rate $i\"}")"
  post_signed /api/channels/whatsapp/inbound "$RB" || true
  if [[ "$STATUS" == "429" ]]; then
    GOT_429=1
    if printf '%s' "$HEADERS" | grep -qi 'Retry-After'; then
      echo "PASS [429]: got rate_limited with Retry-After"
    else
      echo "FAIL [429]: missing Retry-After header" >&2
      FAILS=$((FAILS + 1))
    fi
    break
  fi
done
if [[ "$GOT_429" -eq 0 ]]; then
  echo "WARN [429]: no 429 in burst — stub may have RATE_LIMIT_EVERY=0; not failing"
fi

if [[ -n "${APP_URL:-}" ]]; then
  echo "== app health ($APP_URL) =="
  AC="$(curl -sS -o /dev/null -w '%{http_code}' "$APP_URL/" || true)"
  STATUS="$AC"
  expect_status 200 "app /" || {
    # Next may redirect unauthenticated users — accept 3xx as up.
    if [[ "$AC" =~ ^3 ]]; then echo "PASS [app /]: HTTP $AC (redirect)"; FAILS=$((FAILS - 1)); fi
  }
fi

if [[ -n "${NGINX_URL:-}" ]]; then
  echo "== nginx basic auth ($NGINX_URL) =="
  N1="$(curl -sS -o /dev/null -w '%{http_code}' "$NGINX_URL/" || true)"
  if [[ "$N1" == "401" ]]; then
    echo "PASS [nginx]: 401 without credentials"
  else
    echo "FAIL [nginx]: expected 401 without credentials, got $N1" >&2
    FAILS=$((FAILS + 1))
  fi
  if [[ -n "${BASIC_USER:-}" && -n "${BASIC_PASS:-}" ]]; then
    N2="$(curl -sS -o /dev/null -w '%{http_code}' -u "$BASIC_USER:$BASIC_PASS" "$NGINX_URL/" || true)"
    if [[ "$N2" =~ ^[23] ]]; then
      echo "PASS [nginx]: $N2 with credentials"
    else
      echo "FAIL [nginx]: expected 2xx/3xx with credentials, got $N2" >&2
      FAILS=$((FAILS + 1))
    fi
  fi
fi

rm -f /tmp/wacrm-smoke-headers.$$ /tmp/wacrm-smoke-body.$$ /tmp/wacrm-smoke-status.$$

echo
if [[ "$FAILS" -gt 0 ]]; then
  echo "FAILED: $FAILS check(s)"
  exit 1
fi
echo "All smoke checks passed."
