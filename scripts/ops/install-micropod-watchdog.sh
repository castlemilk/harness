#!/usr/bin/env bash
#
# Install/uninstall the Micropod health watchdog LaunchAgent.
#
#   scripts/ops/install-micropod-watchdog.sh install   [INTERVAL=120]
#   scripts/ops/install-micropod-watchdog.sh uninstall
#   scripts/ops/install-micropod-watchdog.sh status
#
# The watchdog only reports; it never mutates the container runtime. Alerts and
# the latest health JSON land in $OMEGA_STORAGE_ROOT/recovery/micropod/.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LABEL="dev.omega.micropod-health"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
INTERVAL="${INTERVAL:-120}"
STORAGE_ROOT="${OMEGA_STORAGE_ROOT:-$HOME/.omega}"

case "${1:-install}" in
  install)
    mkdir -p "$HOME/Library/LaunchAgents" "$STORAGE_ROOT/recovery/micropod"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$ROOT/scripts/ops/micropod-watchdog.sh</string>
  </array>
  <key>StartInterval</key>
  <integer>$INTERVAL</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$STORAGE_ROOT/recovery/micropod/watchdog.out.log</string>
  <key>StandardErrorPath</key>
  <string>$STORAGE_ROOT/recovery/micropod/watchdog.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OMEGA_STORAGE_ROOT</key>
    <string>$STORAGE_ROOT</string>
  </dict>
</dict>
</plist>
EOF
    launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
    launchctl bootstrap "gui/$UID" "$PLIST"
    launchctl kickstart "gui/$UID/$LABEL" >/dev/null 2>&1 || true
    echo "installed $LABEL (every ${INTERVAL}s); status: $STORAGE_ROOT/recovery/micropod/health.json"
    ;;
  uninstall)
    launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
    rm -f "$PLIST"
    echo "removed $LABEL"
    ;;
  status)
    launchctl print "gui/$UID/$LABEL" 2>&1 | sed -n '1,20p'
    ;;
  *)
    echo "usage: $0 install|uninstall|status" >&2
    exit 1
    ;;
esac