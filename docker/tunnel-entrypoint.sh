#!/bin/sh

TARGET_URL="${TUNNEL_TARGET:-http://frontend:80}"
URL_FILE="${WEBAPP_URL_FILE:-/shared/webapp_url}"
HEALTH_FILE="${TUNNEL_HEALTH_FILE:-/shared/tunnel_ok}"
mkdir -p "$(dirname "$URL_FILE")"

write_url() {
  url=$(printf '%s' "$1" | tr -d '[:space:]')
  if [ -z "$url" ]; then
    return 1
  fi
  current=""
  if [ -f "$URL_FILE" ]; then
    current=$(tr -d '[:space:]' < "$URL_FILE" || true)
  fi
  if [ "$url" != "$current" ]; then
    printf '%s' "$url" > "$URL_FILE"
  fi
  touch "$HEALTH_FILE"
}

clear_tunnel_state() {
  rm -f "$URL_FILE" "$HEALTH_FILE"
}

parse_quick_tunnel_line() {
  line=$1
  case "$line" in
    *trycloudflare.com*)
      url=$(printf '%s\n' "$line" | grep -oE 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' | head -n1 || true)
      if [ -n "$url" ]; then
        write_url "$url"
      fi
      ;;
  esac
}

run_quick_tunnel_once() {
  clear_tunnel_state
  cloudflared tunnel --no-autoupdate --url "$TARGET_URL" 2>&1 | while IFS= read -r line; do
    echo "$line"
    parse_quick_tunnel_line "$line"
  done
}

is_disabled() {
  case "${TUNNEL_DISABLED:-}" in
    1|true|TRUE|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

if is_disabled; then
  fixed_url=$(printf '%s' "${WEBAPP_URL:-}" | tr -d '[:space:]')
  if [ -z "$fixed_url" ]; then
    echo "TUNNEL_DISABLED set but WEBAPP_URL is empty"
    exit 1
  fi
  write_url "$fixed_url"
  while true; do
    sleep 3600
  done
fi

if [ -n "$(printf '%s' "${CLOUDFLARE_TUNNEL_TOKEN:-}" | tr -d '[:space:]')" ]; then
  fixed_url=$(printf '%s' "${WEBAPP_URL:-}" | tr -d '[:space:]')
  if [ -z "$fixed_url" ]; then
    echo "CLOUDFLARE_TUNNEL_TOKEN set but WEBAPP_URL is empty"
    exit 1
  fi
  write_url "$fixed_url"
  while true; do
    clear_tunnel_state
    write_url "$fixed_url"
    cloudflared tunnel --no-autoupdate run --token "$CLOUDFLARE_TUNNEL_TOKEN" || true
    sleep 5
  done
fi

delay=3
while true; do
  run_quick_tunnel_once || true
  clear_tunnel_state
  sleep "$delay"
  if [ "$delay" -lt 30 ]; then
    delay=$((delay + 2))
  fi
done
