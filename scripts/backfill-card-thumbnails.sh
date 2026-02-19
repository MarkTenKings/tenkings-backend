#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-https://collect.tenkings.co}"
OPERATOR_KEY="${OPERATOR_KEY:-}"
LIMIT="${LIMIT:-20}"
TARGET="${TARGET:-both}"

if [[ -z "$OPERATOR_KEY" ]]; then
  echo "Set OPERATOR_KEY in the environment before running."
  echo "Example: OPERATOR_KEY=... API_BASE=https://collect.tenkings.co ./scripts/backfill-card-thumbnails.sh"
  exit 1
fi

echo "Starting thumbnail backfill against ${API_BASE}"
echo "Batch size: ${LIMIT} | Target: ${TARGET}"

while true; do
  response="$(curl -sS -X POST "${API_BASE}/api/admin/thumbnails/backfill" \
    -H "Content-Type: application/json" \
    -H "X-Operator-Key: ${OPERATOR_KEY}" \
    -d "{\"limit\": ${LIMIT}, \"target\": \"${TARGET}\"}")"
  processed="$(echo "$response" | sed -n 's/.*"processed":\([0-9]*\).*/\1/p')"
  updated="$(echo "$response" | sed -n 's/.*"updated":\([0-9]*\).*/\1/p')"
  errors="$(echo "$response" | sed -n 's/.*"errors":\([0-9]*\).*/\1/p')"

  echo "Processed=${processed:-0} Updated=${updated:-0} Errors=${errors:-0}"

  if [[ -z "$processed" || "$processed" -eq 0 ]]; then
    echo "Backfill complete."
    break
  fi
done
