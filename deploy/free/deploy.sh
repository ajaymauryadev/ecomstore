#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"
config_dir="${SMART_KIRANA_CONFIG_DIR:-$HOME/.config/smart-kirana}"
if [[ ! -f "$config_dir/.env" ]]; then
  echo 'Run bash deploy/free/configure.sh first.' >&2
  exit 1
fi
compose=(sudo docker compose --env-file "$config_dir/.env" -f deploy/free/compose.yaml)
"${compose[@]}" config --quiet
sudo docker volume create smart-kirana-free-uploads > /dev/null
# Docker initializes the fresh volume from the API image, whose directory is
# already owned by the unprivileged node user. Existing volumes are preserved.
"${compose[@]}" build
"${compose[@]}" up -d --wait --wait-timeout 180
"${compose[@]}" exec -T api npm run deploy:check
"${compose[@]}" exec -T edge caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
public_host="$(sed -n 's/^PUBLIC_HOST=//p' "$config_dir/.env")"
curl --fail --silent --show-error --retry 12 --retry-all-errors --retry-delay 5 --retry-max-time 100 "https://$public_host/ready"
printf '\n'
"${compose[@]}" exec -T api node --input-type=module - "https://$public_host" < deploy/staging/smoke.mjs
printf '\nLive site: https://%s\n' "$public_host"
