#!/bin/bash
# Uygulamayı günceller (yeniden clone'lamaya gerek yok). Veri uygulama klasörünün dışında olduğu için etkilenmez.
# Kullanım: ./scripts/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
npm install --no-audit --no-fund
PLIST="$HOME/Library/LaunchAgents/local.vbackup.plist"
if [ -f "$PLIST" ]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
  echo "Güncellendi ve otomatik başlatılan uygulama yeniden başlatıldı."
else
  echo "Güncellendi. Uygulama çalışıyorsa durdurup (Ctrl+C) yeniden başlatın: npm start"
fi
