#!/usr/bin/env bash
# Print the current quick-tunnel URL (the public base for EVIDENCE_URL=…/ev and INDEXER_URL=…/ix).
docker logs manmade-tunnel-1 2>&1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1
