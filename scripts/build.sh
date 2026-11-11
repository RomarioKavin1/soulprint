#!/usr/bin/env bash
# Builds every contract to contracts/res/*.wasm and enforces the piece size budget.
# MODE=reproducible (deploy) uses the docker image pinned in each Cargo.toml.
set -euo pipefail
cd "$(dirname "$0")/../contracts"
MODE="${MODE:-non-reproducible}"
BUDGET=$((400 * 1024))
mkdir -p res
cargo clippy --workspace --all-targets -- -D warnings
if command -v cargo-audit >/dev/null; then cargo audit -q || { echo "cargo audit found issues"; exit 1; }; fi
for c in piece collection publisher mock-ft evil-receiver; do
  if [ "$MODE" = reproducible ]; then
    (cd "$c" && cargo near build reproducible-wasm --out-dir ../res)
  else
    (cd "$c" && cargo near build non-reproducible-wasm --locked --no-abi --out-dir ../res >/dev/null 2>&1 || cargo near build non-reproducible-wasm --no-abi --out-dir ../res)
  fi
done
for f in res/*.wasm; do printf '%-28s %8d bytes\n' "$(basename "$f")" "$(wc -c <"$f")"; done
size=$(wc -c <res/piece.wasm)
if [ "$size" -gt "$BUDGET" ]; then echo "piece.wasm $size > budget $BUDGET"; exit 1; fi
echo "piece.wasm within budget ($size <= $BUDGET)"
