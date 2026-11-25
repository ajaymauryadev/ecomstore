#!/bin/bash
set -euo pipefail

# Port 8080 belongs to Caddy; the API is reached through loopback only.
export PORT=5000
export TRUSTED_PROXY_CIDRS=127.0.0.1/32
node scripts/check-deployment.js --ephemeral
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

node server.js &
api_pid=$!
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
edge_pid=$!

shutdown() {
  trap - TERM INT
  kill -TERM "$api_pid" "$edge_pid" 2>/dev/null || true
  wait "$api_pid" 2>/dev/null || true
  wait "$edge_pid" 2>/dev/null || true
}
trap 'shutdown; exit 0' TERM INT

# Restart the entire container if either process exits, even with status zero.
set +e
wait -n "$api_pid" "$edge_pid"
status=$?
shutdown
if [ "$status" -eq 0 ]; then status=1; fi
exit "$status"
