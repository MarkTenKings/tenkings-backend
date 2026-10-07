#!/usr/bin/env bash
set -euo pipefail

# Disposable loopback touchscreen bench. This never configures a physical door.
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export VAULT_STRIPE_TEST_READER_ID='tmr_Grfd3goSmo63gj'
export VAULT_STRIPE_TEST_LOCATION_ID='tml_GrfdkgIYV0Y3Qv'

printf 'Paste the Ten Kings Vault restricted TEST key (input hidden), then press Return: '
IFS= read -r -s VAULT_STRIPE_TEST_SECRET_KEY
printf '\n'
if [[ "$VAULT_STRIPE_TEST_SECRET_KEY" != rk_test_* ]]; then
  printf 'Expected a restricted Stripe test key. No Stripe API call was made.\n' >&2
  exit 2
fi
export VAULT_STRIPE_TEST_SECRET_KEY
trap 'unset VAULT_STRIPE_TEST_SECRET_KEY' EXIT

args=(--doors 72 --stocked --stripe-test --port 55498)
if [[ -f candidate-source.json ]]; then args+=(--source-manifest ./candidate-source.json); fi
node scripts/run-vault-simulator.mjs "${args[@]}"
