#!/usr/bin/env bash
# CHAT-14 verification: stub unit tests + staging smoke + seed dry-run.
# Produces a log under artifacts/chat-14/ for the morning list.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

OUT_DIR="${CHAT14_OUT_DIR:-$ROOT/artifacts/chat-14}"
mkdir -p "$OUT_DIR"
LOG="$OUT_DIR/verify.log"
: >"$LOG"

pass() { echo "PASS $*" | tee -a "$LOG"; }
fail() { echo "FAIL $*" | tee -a "$LOG"; FAILS=$((FAILS + 1)); }

FAILS=0

echo "== CHAT-14 verify $(date -u +%Y-%m-%dT%H:%M:%SZ) ==" | tee -a "$LOG"

echo "== seed dry-run ==" | tee -a "$LOG"
if SEED_ACCOUNT_ID=11111111-1111-4111-8111-111111111111 \
   SEED_USER_ID=22222222-2222-4222-8222-222222222222 \
   node deploy/staging/scripts/seed-demo-data.mjs --dry-run >>"$LOG" 2>&1; then
  pass "seed-demo-data --dry-run"
else
  fail "seed-demo-data --dry-run"
fi

echo "== seed unit tests ==" | tee -a "$LOG"
if node --test deploy/staging/scripts/seed-demo-data.test.mjs >>"$LOG" 2>&1; then
  pass "seed-demo-data.test.mjs"
else
  fail "seed-demo-data.test.mjs"
fi

echo "== connect-stub unit tests ==" | tee -a "$LOG"
if node --test deploy/staging/connect-stub/server.test.js >>"$LOG" 2>&1; then
  pass "connect-stub server.test.js"
else
  fail "connect-stub server.test.js"
fi

# Live smoke against a throwaway stub (no Docker required).
echo "== live stub smoke ==" | tee -a "$LOG"
STUB_PORT="${CHAT14_STUB_PORT:-3199}"
STUB_SECRET="${WACRM_ADAPTER_SECRET:-staging-smoke-secret-ok-32chars}"
export WACRM_ADAPTER_SECRET="$STUB_SECRET"
export CONNECT_STUB_URL="http://127.0.0.1:$STUB_PORT"
export NEXT_PUBLIC_SITE_URL="${NEXT_PUBLIC_SITE_URL:-https://wa.astraconnect.io}"
export RATE_LIMIT_EVERY=5

HOST=127.0.0.1 PORT="$STUB_PORT" WACRM_ADAPTER_SECRET="$STUB_SECRET" \
  RATE_LIMIT_EVERY=5 \
  node deploy/staging/connect-stub/server.js >>"$OUT_DIR/stub.log" 2>&1 &
STUB_PID=$!
cleanup() { kill "$STUB_PID" 2>/dev/null || true; }
trap cleanup EXIT

for i in $(seq 1 50); do
  if curl -sf "$CONNECT_STUB_URL/health" >/dev/null; then break; fi
  sleep 0.1
done

if ! curl -sf "$CONNECT_STUB_URL/health" >/dev/null; then
  fail "stub did not become healthy on $CONNECT_STUB_URL"
else
  if bash deploy/staging/scripts/staging-smoke.sh >>"$LOG" 2>&1; then
    pass "staging-smoke.sh against local stub"
  else
    fail "staging-smoke.sh against local stub"
  fi
fi

echo "== summary fails=$FAILS ==" | tee -a "$LOG"
if [[ "$FAILS" -gt 0 ]]; then
  exit 1
fi
echo "CHAT-14 verification OK" | tee -a "$LOG"
exit 0
