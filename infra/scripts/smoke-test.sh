#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-http://localhost}
WALLET_URL=${WALLET_URL:-$BASE_URL/wallet}
MARKETPLACE_URL=${MARKETPLACE_URL:-$BASE_URL/marketplace}
INGESTION_URL=${INGESTION_URL:-$BASE_URL/ingestion}
PACK_URL=${PACK_URL:-$BASE_URL/pack}
AUTH_URL=${AUTH_URL:-$BASE_URL/auth}
FRONTEND_URL=${FRONTEND_URL:-$BASE_URL}

log() {
  echo "[smoke] $1"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 127
  fi
}

require_command curl
require_command jq

log "Checking health endpoints"

curl -sf "$WALLET_URL/health" | jq '.'
curl -sf "$MARKETPLACE_URL/health" | jq '.'
curl -sf "$INGESTION_URL/health" | jq '.'
curl -sf "$PACK_URL/health" | jq '.'
curl -sf "$AUTH_URL/health" | jq '.'

log "Loading frontend root"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL")
if [ "$STATUS" -ge 400 ]; then
  echo "Frontend responded with status $STATUS" >&2
  exit 1
fi

log "Creating temporary users"
SELLER=$(curl -sf -X POST "$WALLET_URL/users" -H 'Content-Type: application/json' -d '{"email":"smoke-seller@example.com","displayName":"Smoke Seller"}')
BUYER=$(curl -sf -X POST "$WALLET_URL/users" -H 'Content-Type: application/json' -d '{"email":"smoke-buyer@example.com","displayName":"Smoke Buyer"}')
SELLER_ID=$(echo "$SELLER" | jq -r '.user.id')
BUYER_ID=$(echo "$BUYER" | jq -r '.user.id')

log "Funding buyer"
curl -sf -X POST "$WALLET_URL/wallets/$BUYER_ID/credit" -H 'Content-Type: application/json' -d '{"amount":5000,"note":"smoke funding"}' | jq '.'

log "Creating ingestion"
INGESTION_PAYLOAD=$(cat <<JSON
{
  "ownerId": "$SELLER_ID",
  "externalId": "smoke-$(date +%s)",
  "card": {
    "name": "Smoke Test Card",
    "set": "Smoke Set",
    "number": "1",
    "estimatedValue": 4000
  }
}
JSON
)
INGESTION=$(curl -sf -X POST "$INGESTION_URL/ingestions" -H 'Content-Type: application/json' -d "$INGESTION_PAYLOAD")
INGESTION_ID=$(echo "$INGESTION" | jq -r '.ingestion.id')
log "Approving ingestion $INGESTION_ID"
APPROVED=$(curl -sf -X POST "$INGESTION_URL/ingestions/$INGESTION_ID/approve" -H 'Content-Type: application/json' -d '{}')
ITEM_ID=$(echo "$APPROVED" | jq -r '.item.id')

log "Listing item $ITEM_ID"
LISTING_PAYLOAD=$(cat <<JSON
{
  "itemId": "$ITEM_ID",
  "sellerId": "$SELLER_ID",
  "price": 3500
}
JSON
)
LISTING=$(curl -sf -X POST "$MARKETPLACE_URL/listings" -H 'Content-Type: application/json' -d "$LISTING_PAYLOAD")
LISTING_ID=$(echo "$LISTING" | jq -r '.listing.id')

log "Purchasing listing $LISTING_ID"
PURCHASE_PAYLOAD=$(cat <<JSON
{
  "buyerId": "$BUYER_ID"
}
JSON
)
curl -sf -X POST "$MARKETPLACE_URL/listings/$LISTING_ID/purchase" -H 'Content-Type: application/json' -d "$PURCHASE_PAYLOAD" | jq '.'

log "Checking buyer wallet balance"
BALANCE=$(curl -sf "$WALLET_URL/wallets/$BUYER_ID" | jq -r '.wallet.balance')
if [ "$BALANCE" -ne 1500 ]; then
  echo "Unexpected buyer balance: $BALANCE" >&2
  exit 1
fi

log "Smoke test completed successfully"
