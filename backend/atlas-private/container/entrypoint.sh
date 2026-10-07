#!/bin/sh
# Reject loader/native/CA overrides before Node can interpret them. Only the
# fixed official base's inert version metadata is removed, never real options.
set -eu
reject() { echo ATLAS_PRIVATE_CONTAINER_STARTUP_REJECTED >&2; exit 78; }
[ "${NODE_VERSION-}" = '20.20.1' ] || reject
[ "${YARN_VERSION-}" = '1.22.22' ] || reject
if /usr/bin/env | /usr/bin/cut -d= -f1 | /usr/bin/grep -E '^(DEBUG$|NODE_|LD_|DYLD_|PRISMA_|OPENSSL_|SSL_CERT_)' | /usr/bin/grep -Ev '^(NODE_ENV|NODE_VERSION)$' >/dev/null; then
    reject
fi
exec /usr/bin/env -u NODE_VERSION -u YARN_VERSION /usr/local/bin/node /app/container/bootstrap.mjs "$@"
