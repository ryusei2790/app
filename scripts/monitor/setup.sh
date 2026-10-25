#!/bin/bash
# 見張り（check.sh）を launchd に登録する（mywork#764 ④。もう一度流しても壊れない）。PR のマージ後に1回:
#   bash ~/Mywork/dev/kakebo_next/app/scripts/monitor/setup.sh
# 置き場は定期バックアップと同じ専用の作業ツリー（~/.local/share/kakebo-backup。無ければ backup/setup.sh を先に）。
# その作業ツリーを origin/main に合わせてから、毎日 12:30 に check.sh を流す。停止: launchctl bootout gui/$(id -u)/com.ryusei.kakebo-monitor
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
WT="$HOME/.local/share/kakebo-backup"
L=com.ryusei.kakebo-monitor
P="$HOME/Library/LaunchAgents/$L.plist"
[ -d "$WT" ] || { echo "先に bash ~/Mywork/dev/kakebo_next/app/scripts/backup/setup.sh を流してください"; exit 1; }
git -C "$WT" fetch -q origin main && git -C "$WT" checkout -q --detach origin/main
cat > "$P" <<P
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- 家計簿の見張り（mywork#764 ④）。停止: launchctl bootout gui/\$(id -u)/$L -->
<plist version="1.0"><dict>
  <key>Label</key><string>$L</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$WT/scripts/monitor/check.sh</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>12</integer><key>Minute</key><integer>30</integer></dict>
</dict></plist>
P
launchctl bootout "gui/$(id -u)/$L" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$P"
bash "$WT/scripts/monitor/check.sh"
tail -5 "$HOME/Library/Logs/kakebo-monitor.log"
