#!/bin/sh
set -eu
# Launch within the existing Omarchy/Hyprland graphical user session.
[ "$(id -u)" -ne 0 ] || exit 78
[ "$(id -un)" != vault ] || exit 78
[ "${XDG_SESSION_TYPE:-}" = wayland ] || exit 78
umask 077
mkdir -p "$HOME/.config/tenkings-vault/chromium"
# flock makes duplicate autostart entries harmless. Chromium keeps its sandbox.
exec 9>"${XDG_RUNTIME_DIR:?}/tenkings-vault-kiosk.lock"
flock -n 9 || exit 0
while :; do
  /usr/bin/chromium --ozone-platform=wayland --kiosk --no-first-run --no-default-browser-check \
    --disable-session-crashed-bubble --password-store=basic \
    --user-data-dir="$HOME/.config/tenkings-vault/chromium" \
    'http://127.0.0.1:47831/?experience=portrait' || true
  sleep 3
done
