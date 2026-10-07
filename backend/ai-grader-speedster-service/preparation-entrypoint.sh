#!/bin/sh
set -eu

python -m preparation_runtime
if [ "${1-}" = "--validate-only" ]; then
    exit 0
fi
exec "$@"
