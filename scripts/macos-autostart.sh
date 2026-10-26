#!/bin/bash
# vbackup'ı macOS açılışında otomatik başlatır (launchd LaunchAgent).
# Kullanım:  ./scripts/macos-autostart.sh install   |   ./scripts/macos-autostart.sh uninstall
set -euo pipefail

LABEL="local.vbackup"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$(command -v node || true)"
PORT="${PORT:-3000}"

case "${1:-install}" in
  install)
    if [ -z "$NODE_BIN" ]; then echo "node bulunamadı. Önce Node.js 22+ kurun (ör. brew install node)."; exit 1; fi
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>--disable-warning=ExperimentalWarning</string>
    <string>$APP_DIR/server/index.js</string>
  </array>
  <key>WorkingDirectory</key><string>$APP_DIR</string>
  <key>EnvironmentVariables</key>
  <dict><key>PORT</key><string>$PORT</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/vbackup.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/vbackup.log</string>
</dict>
</plist>
EOF
    launchctl unload "$PLIST" 2>/dev/null || true
    launchctl load "$PLIST"
    echo "Kuruldu. Uygulama: http://localhost:$PORT  (log: $HOME/Library/Logs/vbackup.log)"
    ;;
  uninstall)
    launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Otomatik başlatma kaldırıldı."
    ;;
  *)
    echo "Kullanım: $0 install|uninstall"; exit 1 ;;
esac
