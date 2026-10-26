#!/bin/bash
# 週1の定期バックアップを流す（launchd: com.ryusei.kakebo-backup、毎週日曜 10:00。mywork#764 ②）。
# 専用の作業ツリー（~/.local/share/kakebo-backup、origin/main を切り離して置く）を最新にしてから weekly-backup.ts を呼ぶ。
# DB のパスワードはキーチェーン kakebo-supabase-db、age の公開鍵は ~/.config/kakebo-backup/recipient.txt。
# 接続文字列はこのプロセスの中でだけ組み立て、画面・ファイルに出さない。手動: bash run.sh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
WT="$HOME/.local/share/kakebo-backup"
LOG="$HOME/Library/Logs/kakebo-backup.log"
CONF="$HOME/.config/kakebo-backup"
# 手動実行（端末から）のときだけ、終わりにログの最後の1行を画面にも出す（mywork#764）。launchd ではログだけ
if [ -t 1 ]; then
  exec 3>&1
  trap 'echo "$(tail -1 "${LOG}")  （詳細: ${LOG}）" >&3' EXIT
fi
exec >>"$LOG" 2>&1
echo "== $(date '+%F %T')"

cd "$WT"
git fetch -q origin main && git checkout -q --detach origin/main
# 依存が変わったときだけ入れ直す
H=$(shasum package-lock.json | cut -c1-40)
if [ "$(cat node_modules/.lock-hash 2>/dev/null)" != "$H" ]; then
  npm ci --silent && npx prisma generate >/dev/null && echo "$H" > node_modules/.lock-hash
fi

DIR=$(ls -d "$HOME"/Library/CloudStorage/GoogleDrive-*/マイドライブ 2>/dev/null | head -1)
[ -n "$DIR" ] || { echo "Google Drive の同期フォルダがありません"; exit 1; }
PW=$(security find-generic-password -s kakebo-supabase-db -a postgres -w)
DATABASE_URL="postgresql://postgres.vqimpbelkydklhuhhdpg:$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$PW")@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres" \
AGE_RECIPIENT="$(cat "$CONF/recipient.txt")" \
BACKUP_DIR="$DIR/家計簿バックアップ" \
  npx tsx --tsconfig tsconfig.json scripts/backup/weekly-backup.ts
