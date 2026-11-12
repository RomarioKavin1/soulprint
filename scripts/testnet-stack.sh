#!/usr/bin/env bash
# Services + web against the testnet deploy written by `soulprint-deploy` (docs/testnet-deploy.md).
# Usage: scripts/testnet-stack.sh [path/to/<collection>.services.env]
# Default env file: the only *.services.env in ~/.soulprint/testnet. Ctrl-C stops everything.
# Ports: EVIDENCE_PORT (8787), INDEXER_PORT (8788), RELAYER_PORT (8789), WEB_PORT (3000).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${1:-}"
if [ -z "$ENV_FILE" ]; then
  shopt -s nullglob; files=("$HOME"/.soulprint/testnet/*.services.env); shopt -u nullglob
  [ "${#files[@]}" -eq 1 ] || { echo "pass the services env file (found ${#files[@]} in ~/.soulprint/testnet)"; exit 1; }
  ENV_FILE="${files[0]}"
fi
# shellcheck disable=SC1090
source "$ENV_FILE"
LOG="${LOG_DIR:-$ROOT/.superpowers/logs/testnet}"
mkdir -p "$LOG"
pids=()
# pnpm does not forward signals to the node it starts: stop each whole process tree.
killtree() { local c; for c in $(pgrep -P "$1" 2>/dev/null); do killtree "$c"; done; kill "$1" 2>/dev/null || true; }
cleanup() { for p in "${pids[@]}"; do killtree "$p"; done; }
trap cleanup EXIT INT TERM
EVIDENCE_PORT="${EVIDENCE_PORT:-8787}" INDEXER_PORT="${INDEXER_PORT:-8788}" RELAYER_PORT="${RELAYER_PORT:-8789}" WEB_PORT="${WEB_PORT:-3000}"
start() { # name port dir
  local name=$1 port=$2 dir=$3
  (cd "$ROOT/$dir" && PORT="$port" exec pnpm exec tsx src/main.ts) > "$LOG/$name.log" 2>&1 &
  pids+=($!)
  until curl -sf "http://127.0.0.1:$port/health" >/dev/null; do sleep 1; kill -0 "${pids[-1]}" || { cat "$LOG/$name.log"; exit 1; }; done
  echo "$name on :$port"
}
EVIDENCE_DATA_DIR="${EVIDENCE_DATA_DIR:-$HOME/.soulprint/testnet/evidence-data}" start evidence "$EVIDENCE_PORT" services/evidence
INDEXER_DATA_DIR="${INDEXER_DATA_DIR:-$HOME/.soulprint/testnet/indexer-data}" start indexer "$INDEXER_PORT" services/indexer
RELAYER_DATA_DIR="${RELAYER_DATA_DIR:-$HOME/.soulprint/testnet/relayer-data}" start relayer "$RELAYER_PORT" services/relayer
if [ "${NO_WEB:-}" = "" ]; then
  (cd "$ROOT/apps/web" && SOULPRINT_NETWORK=testnet SOULPRINT_CONFIG="${SOULPRINT_CONFIG:-$ROOT/config/networks.json}" \
    EVIDENCE_URL="http://127.0.0.1:$EVIDENCE_PORT" INDEXER_URL="http://127.0.0.1:$INDEXER_PORT" exec pnpm exec next dev -p "$WEB_PORT") > "$LOG/web.log" 2>&1 &
  pids+=($!)
  until curl -sf "http://127.0.0.1:$WEB_PORT" >/dev/null; do sleep 1; kill -0 "${pids[-1]}" || { cat "$LOG/web.log"; exit 1; }; done
  echo "web on http://127.0.0.1:$WEB_PORT (testnet)"
fi
echo "TESTNET STACK READY ($SOULPRINT_COLLECTION)"
wait
