#!/usr/bin/env bash
# Pull main and rebuild the services. Run on the host (by hand or by the GitHub Actions key,
# which is restricted to this script). The tunnel container is left alone so its URL stays.
set -euo pipefail
export MANMADE_HOME="${MANMADE_HOME:-$HOME/manmade}"
cd "$MANMADE_HOME/app"
git fetch --quiet origin main
git reset --quiet --hard origin/main
cd deploy/oci
docker compose -p manmade up -d --build --no-deps evidence indexer relayer proxy
docker compose -p manmade up -d tunnel   # starts it only if it is not running
docker image prune -f >/dev/null
echo "deployed $(git rev-parse --short HEAD)"
