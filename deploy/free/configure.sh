#!/usr/bin/env bash
set -euo pipefail
umask 077

config_dir="${SMART_KIRANA_CONFIG_DIR:-$HOME/.config/smart-kirana}"
mkdir -p "$config_dir"
config_dir="$(cd "$config_dir" && pwd)"
deployment_env="$config_dir/.env"
api_env="$config_dir/.env.api"
if [[ -e "$deployment_env" || -e "$api_env" ]]; then
  echo "Configuration already exists in $config_dir; keeping the existing secrets."
  echo "Edit those files directly when changing the hostname or database."
  exit 0
fi

read -rp 'Public hostname (e.g. my-kirana.duckdns.org, without https://): ' public_host
public_host="${public_host,,}"
if [[ ${#public_host} -gt 253 || ! "$public_host" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
  echo 'Enter a valid DNS hostname, without a scheme, port or path.' >&2
  exit 1
fi
read -rsp 'Atlas connection URI (include /smart-kirana before ?): ' mongodb_uri
printf '\n'
if [[ ! "$mongodb_uri" =~ ^mongodb(\+srv)?://[^/]+/[a-zA-Z0-9_-]+(\?.*)?$ || "$mongodb_uri" == *"'"* || "$mongodb_uri" == *$'\r'* || "$mongodb_uri" == *$'\n'* ]]; then
  echo 'Use a MongoDB URI with a database name. Percent-encode password punctuation; no literal quotes or line breaks.' >&2
  exit 1
fi
if [[ "$api_env" == *"'"* || "$api_env" == *$'\n'* ]]; then
  echo 'Use a configuration directory without quotes or line breaks.' >&2
  exit 1
fi

read -rsp 'ImageKit private key (Enter for local uploads): ' imagekit_key
printf '\n'
if [[ -n "$imagekit_key" && ! "$imagekit_key" =~ ^private_[a-zA-Z0-9+/=_-]+$ ]]; then
  echo 'Invalid ImageKit private key format.' >&2
  exit 1
fi

# Single quotes keep Compose from expanding any dollar signs in the URI/path.
access_key="$(openssl rand -hex 48)"
refresh_key="$(openssl rand -hex 48)"
cookie_key="$(openssl rand -hex 48)"
# Exclusive creation protects an existing deployment even if another setup races.
set -o noclobber
{
  printf "MONGODB_URI='%s'\n" "$mongodb_uri"
  printf 'JWT_ACCESS_SECRET=%s\nJWT_REFRESH_SECRET=%s\nCOOKIE_SECRET=%s\n' "$access_key" "$refresh_key" "$cookie_key"
  printf 'JWT_ACCESS_EXPIRES_IN=15m\nJWT_REFRESH_EXPIRES_IN=7d\n'
  if [[ -n "$imagekit_key" ]]; then
    printf 'IMAGE_STORAGE=imagekit\nIMAGEKIT_PRIVATE_KEY=%s\nIMAGEKIT_FOLDER=/smart-kirana/production\n' "$imagekit_key"
  else
    printf 'IMAGE_STORAGE=local\n'
  fi
} > "$api_env"
{
  printf 'PUBLIC_HOST=%s\n' "$public_host"
  printf "API_ENV_FILE='%s'\n" "$api_env"
} > "$deployment_env"
unset mongodb_uri access_key refresh_key cookie_key imagekit_key
echo "Saved private configuration in $config_dir."
echo 'Next: bash deploy/free/deploy.sh'
