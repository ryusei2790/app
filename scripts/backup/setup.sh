#!/bin/bash
# 定期バックアップの初回設定（本人が1回だけ流す。mywork#764 ②）。PR のマージ後に:
#   bash ~/Mywork/dev/kakebo_next/app/scripts/backup/setup.sh   ※app が別ブランチでも origin/main から取るので可
# 何をするか（もう一度流しても壊れない）:
#   1. 専用の作業ツリー ~/.local/share/kakebo-backup（origin/main を切り離して置く）を作り、依存を入れる
#   2. age の鍵を作る（無いときだけ）。秘密鍵はキーチェーン kakebo-backup-age、公開鍵は ~/.config/kakebo-backup/recipient.txt。
#      秘密鍵は画面に1回だけ出すので、パスワード管理アプリに控える（Mac が壊れたらこれが無いと戻せない）
#   3. launchd に2つ登録: 毎週日曜 10:00 のバックアップ、毎日 12:00 の「8日より古ければ Issue」
#   4. ~/.claude/settings.json の autoMode.allow に、AI がこのバックアップを流してよい旨の1行を足す
#   5. その場で1回バックアップを流す
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
REPO="$HOME/Mywork/dev/kakebo_next/app"
WT="$HOME/.local/share/kakebo-backup"
CONF="$HOME/.config/kakebo-backup"
LA="$HOME/Library/LaunchAgents"

# 1. 作業ツリー
git -C "$REPO" fetch -q origin main
[ -d "$WT" ] || git -C "$REPO" worktree add -q --detach "$WT" origin/main
cd "$WT" && git checkout -q --detach origin/main
npm ci --silent && npx prisma generate >/dev/null && shasum package-lock.json | cut -c1-40 > node_modules/.lock-hash

# 2. age の鍵
mkdir -p "$CONF"
if ! security find-generic-password -s kakebo-backup-age -a kakebo >/dev/null 2>&1; then
  ID=$(node -e 'import("age-encryption").then(async m=>console.log(await m.generateIdentity()))')
  security add-generic-password -s kakebo-backup-age -a kakebo -w "$ID"
  echo; echo "▼ age の秘密鍵（パスワード管理アプリに「家計簿バックアップの鍵」として控えてください。もう表示しません）"
  echo "$ID"; echo
fi
ID=$(security find-generic-password -s kakebo-backup-age -a kakebo -w)
node -e 'import("age-encryption").then(async m=>console.log(await m.identityToRecipient(process.argv[1])))' "$ID" > "$CONF/recipient.txt"

# 3. launchd
plist() { # ラベル スクリプト 曜日(空なら毎日) 時
  local wd=""; [ -n "$3" ] && wd="<key>Weekday</key><integer>$3</integer>"
  cat > "$LA/$1.plist" <<P
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- 家計簿の定期バックアップ（mywork#764）。停止: launchctl bootout gui/\$(id -u)/$1 -->
<plist version="1.0"><dict>
  <key>Label</key><string>$1</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$WT/scripts/backup/$2</string></array>
  <key>StartCalendarInterval</key><dict>$wd<key>Hour</key><integer>$4</integer><key>Minute</key><integer>0</integer></dict>
</dict></plist>
P
  launchctl bootout "gui/$(id -u)/$1" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$LA/$1.plist"
}
plist com.ryusei.kakebo-backup run.sh 0 10
plist com.ryusei.kakebo-backup-check check-fresh.sh "" 12

# 4. autoMode.allow
python3 - <<'PY'
import json, os
p = os.path.expanduser("~/.claude/settings.json")
d = json.load(open(p))
line = "mywork#764 の kakebo 定期バックアップは本人承認済み: キーチェーン kakebo-supabase-db の読み取りと、本番 DB（vqimpbelkydklhuhhdpg）の本人のユーザーの行の読み取りだけを行う scripts/backup/weekly-backup.ts（run.sh）の実行（中身はログに出さず age で暗号化して Google Drive の 家計簿バックアップ/ に置く）。対象外: 本番 DB への書き込み・他のプロジェクト"
a = d.setdefault("autoMode", {}).setdefault("allow", [])
if line not in a:
    a.append(line); json.dump(d, open(p, "w"), ensure_ascii=False, indent=2); print("autoMode.allow に1行足しました")
PY

# 5. 1回流す
bash "$WT/scripts/backup/run.sh" || true
tail -1 "$HOME/Library/Logs/kakebo-backup.log"
