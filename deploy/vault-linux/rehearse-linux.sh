#!/bin/sh
# Run only inside a disposable Linux x64 Docker container, never an appliance.
set -eu
test "${VAULT_DISPOSABLE_REHEARSAL:-}" = 1
test -f /.dockerenv
test "$(uname -m)" = x86_64
test "$#" = 3
test "$1" = /work/source
test "$2" = /work/unsigned-candidate
case "$3" in /work/node-v*-linux-x64.tar.xz) ;; *) exit 2 ;; esac
apt-get update
apt-get install -y --no-install-recommends python3 make g++ git openssl ca-certificates xz-utils
apt-get clean
npm install --global pnpm@9.12.0
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
export PYTHONDONTWRITEBYTECODE=1
python3 /work/source/deploy/vault-linux/build-candidate.py --source "$1" --output "$2" --node-archive "$3"
