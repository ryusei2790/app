#!/bin/bash
# 定期バックアップが止まっていないかを見る（launchd: com.ryusei.kakebo-backup-check、毎日 12:00。mywork#764 ②）。
# 最後に ok:true だったバックアップが8日より古ければ（または無ければ）、俺待ちの Issue を1本だけ立てる（開いていれば立てない）。
# Drive の一覧は launchd から起動した bash だと TCC に拒まれて空になる（mywork#839 の誤検知）ので、ログの ok:true 行のファイル名で見る。
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
LOG="$HOME/Library/Logs/kakebo-backup.log"
LATEST=$(grep '"ok":true' "$LOG" 2>/dev/null | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}_kakebo-full\.json\.age' | sort | tail -1)
LIMIT=$(date -v-8d +%F)
if [ -n "$LATEST" ] && [[ "${LATEST:0:10}" > "$LIMIT" || "${LATEST:0:10}" == "$LIMIT" ]]; then exit 0; fi

TITLE="家計簿の定期バックアップが止まっています"
gh issue list -R ryusei2790/mywork -S "$TITLE in:title" --state open --json number -q '.[0].number' | grep -q . && exit 0
N=$("$HOME/Mywork/.claude/scripts/gh-wait.sh" new "$TITLE" "最新: ${LATEST:-なし}（8日より古い）。ログ: ~/Library/Logs/kakebo-backup.log。手で流す: bash ~/.local/share/kakebo-backup/scripts/backup/run.sh（mywork#764）" dept:dev type:task)
"$HOME/Mywork/.claude/scripts/gh-wait.sh" me "$N" "Mac で上のコマンドを1回流して、ログの最後の行が ok:true か見てください。A 流した / B Mac を開いていなかっただけ（次の日曜に流れる）"
