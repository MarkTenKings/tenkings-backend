#!/bin/sh
set -eu

fail_contract() {
  echo "$1" >&2
  exit 78
}

[ "${CUBLAS_WORKSPACE_CONFIG:-}" = ':4096:8' ] \
  || fail_contract 'CUBLAS_WORKSPACE_CONFIG must be exactly :4096:8; refusing to start.'
[ "${CC:-}" = '/usr/bin/gcc-14' ] \
  || fail_contract 'CC must be exactly /usr/bin/gcc-14; refusing to start.'
[ "${SPEEDSTER_COMPILER_PACKAGE_VERSION:-}" = '14.2.0-19' ] \
  || fail_contract 'SPEEDSTER_COMPILER_PACKAGE_VERSION must be exactly 14.2.0-19; refusing to start.'
[ "${SPEEDSTER_LIBC_DEV_PACKAGE_VERSION:-}" = '2.41-12+deb13u3' ] \
  || fail_contract 'SPEEDSTER_LIBC_DEV_PACKAGE_VERSION must be exactly 2.41-12+deb13u3; refusing to start.'
[ "${SPEEDSTER_COMPILER_VERSION:-}" = '14.2.0' ] \
  || fail_contract 'SPEEDSTER_COMPILER_VERSION must be exactly 14.2.0; refusing to start.'
[ "${SPEEDSTER_COMPILER_TARGET:-}" = 'x86_64-linux-gnu' ] \
  || fail_contract 'SPEEDSTER_COMPILER_TARGET must be exactly x86_64-linux-gnu; refusing to start.'
[ -x "$CC" ] || fail_contract 'Configured CC is not executable; refusing to start.'

cc_version="$($CC -dumpfullversion 2>/dev/null)" \
  || fail_contract 'Configured CC version cannot be read; refusing to start.'
cc_target="$($CC -dumpmachine 2>/dev/null)" \
  || fail_contract 'Configured CC target cannot be read; refusing to start.'
cc_package="$(dpkg-query -W -f='${Version}' gcc-14 2>/dev/null)" \
  || fail_contract 'Configured CC package identity cannot be read; refusing to start.'
libc_dev_package="$(dpkg-query -W -f='${Version}' libc6-dev 2>/dev/null)" \
  || fail_contract 'Configured libc development package identity cannot be read; refusing to start.'

[ "$cc_version" = "$SPEEDSTER_COMPILER_VERSION" ] \
  || fail_contract 'Configured CC version does not match the immutable image contract; refusing to start.'
[ "$cc_target" = "$SPEEDSTER_COMPILER_TARGET" ] \
  || fail_contract 'Configured CC target does not match the immutable image contract; refusing to start.'
[ "$cc_package" = "$SPEEDSTER_COMPILER_PACKAGE_VERSION" ] \
  || fail_contract 'Configured CC package does not match the immutable image contract; refusing to start.'
[ "$libc_dev_package" = "$SPEEDSTER_LIBC_DEV_PACKAGE_VERSION" ] \
  || fail_contract 'Configured libc development package does not match the immutable image contract; refusing to start.'

probe_directory="$(mktemp -d /tmp/speedster-compiler-probe.XXXXXX)" \
  || fail_contract 'Compiler startup probe directory cannot be created; refusing to start.'
trap 'rm -rf "$probe_directory"' EXIT HUP INT TERM
if ! "$CC" -shared -fPIC -O2 \
  -I/usr/local/include/python3.12 \
  /usr/local/share/speedster/compiler_probe.c \
  -o "$probe_directory/speedster_compiler_probe.so"; then
  fail_contract 'Configured CC failed the Python shared-object startup probe; refusing to start.'
fi
[ -s "$probe_directory/speedster_compiler_probe.so" ] \
  || fail_contract 'Configured CC produced no Python shared object; refusing to start.'
rm -rf "$probe_directory"
trap - EXIT HUP INT TERM

if [ "${1:-}" = '--validate-only' ]; then
  [ "$#" -eq 1 ] || fail_contract 'Compiler validation accepts no additional arguments.'
  exit 0
fi
exec "$@"
