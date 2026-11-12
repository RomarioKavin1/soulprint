#!/usr/bin/env bash
# Local demo stack: sandbox chain (contracts deployed, demo accounts funded) → evidence service → web.
# Writes config/networks.json (sandbox entry). Ctrl-C stops everything.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="${LOG_DIR:-$ROOT/.superpowers/logs}"
mkdir -p "$LOG" "$ROOT/config"
pids=()
# pnpm does not forward signals to the node it starts: stop each whole process tree.
killtree() { local c; for c in $(pgrep -P "$1" 2>/dev/null); do killtree "$c"; done; kill "$1" 2>/dev/null || true; }
cleanup() { for p in "${pids[@]}"; do killtree "$p"; done; }
trap cleanup EXIT INT TERM

[ -f "$ROOT/contracts/res/piece.wasm" ] || bash "$ROOT/scripts/build.sh"
(cd "$ROOT/contracts" && cargo build -q -p soulprint-sandbox)
rm -f "$ROOT/config/networks.json.ready"
(cd "$ROOT" && exec "$ROOT/contracts/target/debug/soulprint-sandbox" --config "$ROOT/config/networks.json") > "$LOG/sandbox.log" 2>&1 &
pids+=($!)
echo "waiting for the sandbox…"
until grep -q "^READY" "$LOG/sandbox.log" 2>/dev/null; do sleep 1; kill -0 "${pids[0]}" || { cat "$LOG/sandbox.log"; exit 1; }; done
grep "^READY" "$LOG/sandbox.log"

export EVIDENCE_MASTER_KEY="${EVIDENCE_MASTER_KEY:-$(printf '07%.0s' {1..32})}"
export EVIDENCE_VERIFIER_SEED="${EVIDENCE_VERIFIER_SEED:-$(printf '4d%.0s' {1..32})}" # World verifier [77;32]
export EVIDENCE_VERIFIER_KEY_ID=1 EVIDENCE_DATA_DIR="${EVIDENCE_DATA_DIR:-$LOG/evidence-data}"
rm -rf "$EVIDENCE_DATA_DIR"
(cd "$ROOT/services/evidence" && exec pnpm exec tsx src/main.ts --sandbox) > "$LOG/evidence.log" 2>&1 &
pids+=($!)
until curl -sf http://127.0.0.1:8787/health >/dev/null; do sleep 1; kill -0 "${pids[1]}" || { cat "$LOG/evidence.log"; exit 1; }; done
echo "evidence service on :8787"

# The sandbox keeps only recent blocks, so the indexer must follow from the start.
(cd "$ROOT/services/indexer" && exec pnpm exec tsx src/main.ts --sandbox) > "$LOG/indexer.log" 2>&1 &
pids+=($!)
until curl -sf http://127.0.0.1:8788/health >/dev/null; do sleep 1; kill -0 "${pids[2]}" || { cat "$LOG/indexer.log"; exit 1; }; done
echo "indexer on :8788"

(cd "$ROOT/services/relayer" && exec pnpm exec tsx src/main.ts --sandbox) > "$LOG/relayer.log" 2>&1 &
pids+=($!)
until curl -sf http://127.0.0.1:8789/health >/dev/null; do sleep 1; kill -0 "${pids[3]}" || { cat "$LOG/relayer.log"; exit 1; }; done
echo "relayer on :8789"

if [ "${NO_WEB:-}" = "" ]; then
  (cd "$ROOT/apps/web" && SOULPRINT_NETWORK=sandbox SOULPRINT_CONFIG="$ROOT/config/networks.json" exec pnpm dev) > "$LOG/web.log" 2>&1 &
  pids+=($!)
  until curl -sf http://127.0.0.1:3000 >/dev/null; do sleep 1; kill -0 "${pids[4]}" || { cat "$LOG/web.log"; exit 1; }; done
  echo "web on http://127.0.0.1:3000"
fi
echo "STACK READY"
wait
