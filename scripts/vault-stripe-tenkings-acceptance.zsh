#!/bin/zsh
set -euo pipefail

# Ten Kings test-account acceptance. The secret exists only in this process.
cd "${0:A:h}/.."
export VAULT_STRIPE_TEST_READER_ID='tmr_Grfd3goSmo63gj'
export VAULT_STRIPE_TEST_LOCATION_ID='tml_GrfdkgIYV0Y3Qv'
export VAULT_STRIPE_TEST_MACHINE_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"

printf 'Paste the Ten Kings Vault restricted TEST key (input hidden), then press Return: '
IFS= read -r -s VAULT_STRIPE_TEST_SECRET_KEY
printf '\n'
if [[ "$VAULT_STRIPE_TEST_SECRET_KEY" != rk_test_* ]]; then
  printf 'Expected a restricted Stripe test key. No Stripe API call was made.\n' >&2
  exit 2
fi
export VAULT_STRIPE_TEST_SECRET_KEY
trap 'unset VAULT_STRIPE_TEST_SECRET_KEY' EXIT

node scripts/vault-stripe-sandbox.mjs
node scripts/vault-stripe-sandbox.mjs --run-test-payment --scenario=success
node scripts/vault-stripe-sandbox.mjs --run-test-payment --scenario=decline
node scripts/vault-stripe-sandbox.mjs --run-test-payment --scenario=cancel
