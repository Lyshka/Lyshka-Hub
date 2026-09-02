#!/bin/sh
set -e

URL_FILE="${WEBAPP_URL_FILE:-/shared/webapp_url}"
fixed_url=$(printf '%s' "${WEBAPP_URL:-}" | tr -d '[:space:]')

echo "Waiting for database..."
i=0
until npx prisma migrate deploy; do
  i=$((i + 1))
  if [ "$i" -ge 40 ]; then
    echo "Database is not ready"
    exit 1
  fi
  echo "Retry migrate deploy ($i)..."
  sleep 3
done

if [ -n "$fixed_url" ]; then
  if [ ! -s "$URL_FILE" ]; then
    i=0
    while [ ! -s "$URL_FILE" ]; do
      i=$((i + 1))
      if [ "$i" -ge 30 ]; then
        break
      fi
      sleep 1
    done
  fi
  echo "Using WEBAPP_URL from environment"
else
  echo "Waiting for tunnel URL at $URL_FILE ..."
  i=0
  while [ ! -s "$URL_FILE" ]; do
    i=$((i + 1))
    if [ "$i" -ge 180 ]; then
      echo "Tunnel URL was not received"
      exit 1
    fi
    sleep 2
  done
  echo "Tunnel URL is ready"
fi

exec node dist/main.js
